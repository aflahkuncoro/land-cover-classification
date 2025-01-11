/// ---------- Supervised Land Cover Classification ----------- ///////  

// Center the map on the Area of Interest (AOI) and set zoom level.  
Map.centerObject(AOI, 11);

/// --- 1. Landsat 9 Imagery Preprocessing ------------------- ///////  

// Function to mask unwanted pixels and apply scaling factors.  
function maskL9sr(image) {  
  // Bitmask for QA - filtering clouds, cirrus, and shadows.  
  var qaMask = image.select('QA_PIXEL').bitwiseAnd(parseInt('11111', 2)).eq(0);  
  var saturationMask = image.select('QA_RADSAT').eq(0);  

  // Apply scale factors to optical and thermal bands.  
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);  
  var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0);  

  return image.addBands(opticalBands, null, true)  
              .addBands(thermalBands, null, true)  
              .updateMask(qaMask)  
              .updateMask(saturationMask);  
}  

/// --- 2. Filtering and Clipping to the AOI ------------- ///////  

// Filter and process Landsat 9 collection for 2023.  
var collection = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')  
                     .filterDate('2023-01-01', '2023-12-31')  
                     .map(maskL9sr);  

// Combine the collection into a median composite and clip to AOI.  
var median = collection.median();  
var clipped = median.clipToCollection(AOI);  

// Visualize the composite image.  
Map.addLayer(clipped, {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min: 0, max: 0.3}, 'Landsat 9 Composite 2023');

/// --- 3. Sampling and Splitting for Training --------------- ///////  

// Merge all training class features.  
var sample_class = ricefield.merge(non_ricefield);  

// Sample the region and add a random column for data splitting.  
var Tot_samples = clipped.sampleRegions({  
  collection: sample_class,  
  properties: ['lc'],  
  scale: 30  
}).randomColumn('random');  

// Split into training (70%) and validation (30%) datasets.  
var training = Tot_samples.filter(ee.Filter.lt('random', 0.7));  
var validation = Tot_samples.filter(ee.Filter.gte('random', 0.7));  

print('Training Samples:', training.aggregate_count('.all'));  
print('Validation Samples:', validation.aggregate_count('.all'));

/// --- 4. Training Classification Using Random Forest ------- ///////  

// Train the Random Forest model.  
var RF_classifier = ee.Classifier.smileRandomForest({numberOfTrees: 100}).train({  
  features: training,  
  classProperty: 'lc',  
  inputProperties: clipped.bandNames()  
});  

/// --- 5. Classification and Visualizing Results ----------- ///////  

// Apply the model to classify the entire AOI.  
var ClassificationResult = clipped.classify(RF_classifier);  
var Result = ClassificationResult.clip(AOI_ricefield);  

// Add classification results to the map with a legend.  
var legend = [  
  'green', // Rice fields  
  'red'    // Non-rice fields  
];  
Map.addLayer(Result, {palette: legend, min: 0, max: 1}, 'Classification Result 2023');

/// --- 6. Evaluating Classification Accuracy ---------------- ///////  

// Classify the validation dataset.  
var validation_predict = validation.classify(RF_classifier);  

// Evaluate model performance using confusion matrix.  
function evaluateClassificationPerformance(validation_predict, reference, predicted) {  
  var ValidCM = validation_predict.errorMatrix(reference, predicted);  
  print('Validation Confusion Matrix RF:', ValidCM);  
  print('Overall Accuracy RF:', ValidCM.accuracy());  
  print('Kappa Score RF:', ValidCM.kappa());  
  print('Consumer Accuracy RF:', ValidCM.consumersAccuracy());  
  print('Producer Accuracy RF:', ValidCM.producersAccuracy());  
  print('F1 Score RF:', ValidCM.fscore());  
}  

evaluateClassificationPerformance(validation_predict, 'lc', 'classification');

/// ------- Step 7: Export Results as Shapefile -------------- ///////  

// Convert classified image into vector features.  
var classifiedFeatures = Result.select('classification').reduceToVectors({  
  geometry: AOI_ricefield,  
  scale: 30,  
  geometryType: 'polygon',  
  eightConnected: false,  
  labelProperty: 'class',  
  reducer: ee.Reducer.countEvery()  
});  

// Filter areas classified as "ricefield" (class 0).  
var classifiedRicefield = classifiedFeatures.filter(ee.Filter.eq('class', 0));  

// Export the shapefile to Google Drive.  
Export.table.toDrive({  
  collection: classifiedRicefield,  
  description: 'Classification_Result_2023',  
  folder: 'GEE Export',  
  fileFormat: 'SHP'  
});
