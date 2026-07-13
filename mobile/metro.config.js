const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const mobile = __dirname;
const brain = path.resolve(mobile, '..', 'brain');

module.exports = mergeConfig(getDefaultConfig(mobile), {
  watchFolders: [brain],
  resolver: {
    nodeModulesPaths: [path.join(mobile, 'node_modules')],
    extraNodeModules: {
      zod: path.join(mobile, 'node_modules', 'zod'),
    },
  },
});
