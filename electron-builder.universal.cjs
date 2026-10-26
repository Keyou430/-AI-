const { build } = require('./package.json');
module.exports = {
  ...build,
  files: [...build.files, '!dist-electron/services/authService.js', '!dist-electron/services/authService.js.map'],
  extraMetadata: { authMode: 'remote' },
  nsis: { ...build.nsis, artifactName: 'video-remix-universal-setup-${version}.exe' },
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
};
