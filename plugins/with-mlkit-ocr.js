const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

// ML Kit's text recognizer comes from Google Play services. Asking for it at install time means
// the first sign photo is read instead of failing while the model downloads.
module.exports = function withMlKitOcr(config) {
  return withAndroidManifest(config, (result) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(result.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, "com.google.mlkit.vision.DEPENDENCIES", "ocr");
    return result;
  });
};
