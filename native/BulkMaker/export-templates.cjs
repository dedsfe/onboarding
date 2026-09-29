const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'templates-data.js'), 'utf8');
const sandbox = {};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'templates-data.js' });

const templates = sandbox.CarouselTemplates.getAll().map(template => {
  const frames = template.generateFrames();
  const binds = [...new Set(frames.flatMap(frame =>
    (frame.children || []).map(child => child.bind).filter(Boolean)
  ))];
  return {
    id: template.id,
    title: template.title,
    categoryLabel: template.categoryLabel,
    description: template.description,
    slideCount: frames.length,
    aspect: template.aspect,
    binds,
    frames,
  };
});

const destination = path.join(__dirname, 'Sources/BulkMaker/Resources/templates.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(templates, null, 2) + '\n');
console.log(`Exported ${templates.length} templates to ${destination}`);
