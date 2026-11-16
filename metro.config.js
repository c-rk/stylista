const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Body mesh data and the segmentation network ship as bundled binary assets.
config.resolver.assetExts.push('bin', 'onnx');

module.exports = config;
