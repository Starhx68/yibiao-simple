const docxPreviewPattern = /node_modules[\\/]docx-preview[\\/]/;

function patchRules(rules) {
  if (!Array.isArray(rules)) return;
  for (const rule of rules) {
    if (rule) {
      const byLoader = String(rule.loader || '').includes('source-map-loader');
      const uses = Array.isArray(rule.use) ? rule.use : [rule.use];
      const hasSourceMapLoader = uses.some((item) => {
        if (typeof item === 'string') {
          return item.includes('source-map-loader');
        }
        return String(item?.loader || '').includes('source-map-loader');
      });
      if (byLoader || hasSourceMapLoader) {
        if (!rule.exclude) {
          rule.exclude = [docxPreviewPattern];
        } else if (Array.isArray(rule.exclude)) {
          rule.exclude = [...rule.exclude, docxPreviewPattern];
        } else {
          rule.exclude = [rule.exclude, docxPreviewPattern];
        }
      }
    }
    if (Array.isArray(rule?.oneOf)) {
      patchRules(rule.oneOf);
    }
    if (Array.isArray(rule?.rules)) {
      patchRules(rule.rules);
    }
  }
}

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      patchRules(webpackConfig?.module?.rules);
      return webpackConfig;
    },
  },
};
