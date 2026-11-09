/**
 * 配置项完整性的三处交叉检查（数据无关）
 *
 * 一个配置项要同时存在于三处才能被锅巴正常读写：
 *   ① `guoba/index.js` 的 field（点分路径）
 *   ② `defSet/config.yaml` 的模板变量 `${atlas_<下划线路径>}`
 *   ③ `components/config.js` 的 defaultConfig（缺省值的权威清单）
 * 再加 `config/config.yaml.example` 给不用锅巴的人看。
 *
 * 例外：`blacklist.patterns` 不落 config.yaml，而是写独立黑名单文件（见 `components/blacklist.js`），
 * 所以它没有 defSet 模板变量，属正常。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pluginRoot, installFrameworkStubs, checker } from './_helper.mjs'

installFrameworkStubs()
const { check, finish } = checker()

const read = (rel) => fs.readFileSync(path.join(pluginRoot, rel), 'utf8')

const guoba = read('guoba/index.js')
const defSet = read('defSet/config.yaml')
const example = read('config/config.yaml.example')

/** 锅巴里注册的字段（点分路径） */
const fields = [...guoba.matchAll(/field:\s*'([\w.]+)'/g)].map((m) => m[1])

/** 不落 config.yaml 的特殊字段（自写文件） */
const FILE_BACKED = new Set(['blacklist.patterns'])

console.log('=== ① 锅巴字段 → defSet 模板变量 ===')
{
  const missing = fields
    .filter((field) => !FILE_BACKED.has(field))
    .filter((field) => !defSet.includes('${atlas_' + field.replace(/\./g, '_') + '}'))
  check(`全部锅巴字段都有 defSet 变量（${fields.length} 个字段）`, missing.length === 0,
    missing.length ? `缺：${missing.join(', ')}` : '')
}

console.log('\n=== ② defSet 变量 → 锅巴字段（反向，防多余变量）===')
{
  const vars = [...defSet.matchAll(/\$\{atlas_(\w+)\}/g)].map((m) => m[1])
  const known = new Set(fields.map((f) => f.replace(/\./g, '_')))
  const orphan = vars.filter((name) => !known.has(name))
  check('没有锅巴读不到的模板变量', orphan.length === 0, orphan.length ? `多余：${orphan.join(', ')}` : '')
}

console.log('\n=== ③ 锅巴字段 → config.yaml.example（不用锅巴的人也要能看到）===')
{
  const missing = fields
    .filter((field) => !FILE_BACKED.has(field))
    .filter((field) => {
      // 顶层字段直接找 key；嵌套字段找末级 key
      const leaf = field.split('.').pop()
      return !new RegExp('^\\s*' + leaf + ':', 'm').test(example)
    })
  check('全部字段在 example 里可见', missing.length === 0, missing.length ? `缺：${missing.join(', ')}` : '')
}

console.log('\n=== ④ defaultConfig 覆盖主要分组 ===')
{
  const configSrc = read('components/config.js')
  const defaultBlock = configSrc.slice(
    configSrc.indexOf('const defaultConfig'),
    configSrc.indexOf('function deepMerge')
  )
  // 锅巴里的一级分组（取 field 的第一段）
  const groups = [...new Set(fields.map((f) => f.split('.')[0]))]
    .filter((g) => g !== 'blacklist') // 文件型配置不进 defaultConfig
  const missing = groups.filter((group) => !new RegExp('\\b' + group + ':').test(defaultBlock))
  check(`defaultConfig 覆盖 ${groups.length} 个分组`, missing.length === 0,
    missing.length ? `缺：${missing.join(', ')}` : '')
  check('imagePrune.enabled 默认 true', /imagePrune:\s*\{[^}]*enabled:\s*true/s.test(defaultBlock))
}

finish()