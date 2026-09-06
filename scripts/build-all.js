// build-all.js — builds every experiment in experiments/ and assembles _site/,
// the static output that GitHub Pages serves. Each experiment keeps its own
// webpack config; dependencies resolve from the root node_modules.

const path = require('path')
const fs = require('fs')
const webpack = require('webpack')

const root = path.join(__dirname, '..')
const experimentsDir = path.join(root, 'experiments')
const siteDir = path.join(root, '_site')

const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory()

function listExperiments() {
  if (!isDir(experimentsDir)) return []
  return fs.readdirSync(experimentsDir)
    .filter((d) => isDir(path.join(experimentsDir, d)))
    .sort()
}

function buildOne(name) {
  const expDir = path.join(experimentsDir, name)
  const configPath = path.join(expDir, 'config', 'webpack.config.js')
  if (!fs.existsSync(configPath)) {
    throw new Error(`No webpack config for experiment "${name}": ${configPath}`)
  }

  return new Promise((resolve, reject) => {
    // The config computes paths from process.cwd(), so load it from the experiment dir.
    const prevCwd = process.cwd()
    process.chdir(expDir)
    let config
    try {
      config = require(configPath)
    } finally {
      process.chdir(prevCwd)
    }

    webpack(config, (err, stats) => {
      if (err) return reject(err)
      if (stats.hasErrors()) {
        return reject(new Error(stats.toString({all: false, errors: true, errorDetails: true})))
      }
      console.log(stats.toString({all: false, assets: true, colors: true}))
      resolve()
    })
  })
}

function titleize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function assemble(names) {
  fs.rmSync(siteDir, {recursive: true, force: true})
  fs.mkdirSync(path.join(siteDir, 'experiments'), {recursive: true})

  // Landing page lives at the repo root; copy it and its manifest next to it.
  fs.copyFileSync(path.join(root, 'index.html'), path.join(siteDir, 'index.html'))

  const manifest = []
  for (const name of names) {
    const dist = path.join(experimentsDir, name, 'dist')
    if (!isDir(dist)) throw new Error(`Experiment "${name}" produced no dist/`)
    fs.cpSync(dist, path.join(siteDir, 'experiments', name), {recursive: true})
    manifest.push({name, title: titleize(name), path: `experiments/${name}/`})
  }
  fs.writeFileSync(path.join(siteDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

async function main() {
  const names = listExperiments()
  if (names.length === 0) console.warn('No experiments found in experiments/ — nothing to build.')
  for (const name of names) {
    console.log(`\n=== Building ${name} ===`)
    await buildOne(name)
  }
  const manifest = assemble(names)
  console.log(`\nBuilt ${manifest.length} experiment(s) into _site/`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
