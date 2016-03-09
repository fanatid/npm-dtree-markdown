#!/usr/bin/env node
'use strict'
var http = require('http')
var fs = require('fs')
var path = require('path')
var co = require('co')
var semver = require('semver')

var argv = require('yargs').command('npm-rdtree-markdown <package>')
  .option('s', {
    alias: 'silent',
    demand: false,
    type: 'boolean',
    describe: 'Silent mode',
    default: false
  })
  .help()
  .argv

function getPackageInfo (name) {
  return new Promise((resolve, reject) => {
    if (!argv.silent) console.log(`Request http://registry.npmjs.org/${name}`)
    let req = http.request({ host: 'registry.npmjs.org', path: `/${name}` }, (res) => {
      let body = ''
      res.on('error', (err) => reject(err))
      res.on('data', (data) => { body += data })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (err) { reject(err) }
      })
    })
    req.on('error', (err) => reject(err))
    req.end()
  })
}

co.wrap(function * () {
  let packageInfoRoot = yield co.wrap(function * () {
    if (argv._[0]) return yield getPackageInfo(argv._[0])
    var fullPath = path.join(process.cwd(), 'package.json')
    var content = fs.readFileSync(fullPath, { encoding: 'utf-8' })
    return JSON.parse(content)
  })()

  let packages = {}
  let queue = []

  function processInfo (item, info) {
    let versions = Object.keys(info.versions).sort(semver.compareLoose)
    let latestVersion = versions[versions.length - 1]
    let latestDependencies = info.versions[latestVersion].dependencies || {}
    let dependencies = Object.keys(latestDependencies).sort().map((name) => {
      return { name, deep: false }
    })

    let githubURL = (function () {
      if (info.homepage) return info.homepage
      if (info.repository) return info.repository.url ? info.repository.url : info.repository
      return ''
    })().split('/').slice(-2).join('/').split('#')[0]

    packages[info.name] = { dependencies, github: githubURL }
    if (item.parent !== null) {
      for (let obj of packages[item.parent].dependencies) {
        if (obj.name === info.name) obj.deep = true
      }
    }

    for (let item of dependencies) queue.push({ name: item.name, parent: info.name })
  }

  processInfo({ parent: null }, packageInfoRoot)
  while (queue.length > 0) {
    let item = queue.shift()
    if (!packages[item.name]) processInfo(item, yield getPackageInfo(item.name))
  }

  if (!argv.silent) {
    console.log('Data collection is finished!')
    console.log('================================================================================')
  }

  // generate dependencies tree
  ;(function printTree (name, padding) {
    console.log(`${padding}- [${name}](#${name.replace(/\./g, '')})`)
    for (let item of packages[name].dependencies) {
      if (item.deep) {
        printTree(item.name, padding + '  ')
      } else {
        console.log(`${padding}  - [${item.name}](#${item.name.replace(/\./g, '')})`)
      }
    }
  })(packageInfoRoot.name, '')

  // generate table
  console.log(`\n| package | npm | dependencies | github issues |\n|:-:|:-:|:-:|:-:|`)
  Object.keys(packages).sort().forEach((name) => {
    let info = packages[name]
    console.log(`| <h6><a href="https://github.com/${info.github}">${name}</a></h6> | [![](https://img.shields.io/npm/v/${name}.svg?style=flat-square)](https://www.npmjs.org/package/${name}) | [![](https://img.shields.io/david/${info.github}.svg?style=flat-square)](https://david-dm.org/${info.github}#info=dependencies) | [![](https://img.shields.io/github/issues-raw/${info.github}.svg?style=flat-square)](https://github.com/${info.github}/issues) |`)
  })

  if (!argv.silent) {
    console.log('================================================================================')
  }
})().catch((err) => console.error(err.stack || err))
