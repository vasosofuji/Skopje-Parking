const { withAppBuildGradle } = require("expo/config-plugins");

// Ninja on Windows still has a 260-character object path limit. Ask CMake
// to hash long generated filenames instead of relying on drive aliases.
module.exports = function withShortCMakePaths(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== "groovy")
      throw new Error("Short CMake paths require the Expo Groovy Android template.");
    const marker = "// Skopje Parking: short generated CMake object paths";
    if (!result.modResults.contents.includes(marker)) {
      const pattern = /defaultConfig\s*\{/;
      if (!pattern.test(result.modResults.contents))
        throw new Error("Android defaultConfig was not found; cannot configure safe object paths.");
      result.modResults.contents = result.modResults.contents.replace(pattern,
        `defaultConfig {
        ${marker}
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=250"
            }
        }`);
    }
    return result;
  });
};
