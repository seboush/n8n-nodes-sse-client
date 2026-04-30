const { src, dest } = require('gulp');

function buildIcons() {
  return src('nodes/**/*.{svg,json}').pipe(dest('dist/nodes/'));
}

exports['build:icons'] = buildIcons;
