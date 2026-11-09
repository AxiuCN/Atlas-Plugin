import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { pluginRoot, tmpDir, ensureTmpDir, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
const { check, finish } = checker()
ensureTmpDir()
const root = fs.mkdtempSync(path.join(tmpDir, 'alias-edit-'))
try {
  for (const rel of ['model', 'components', 'modules', 'resources/alias', 'resources/patch']) {
    fs.cpSync(path.join(pluginRoot, rel), path.join(root, rel), { recursive: true })
  }
  fs.mkdirSync(path.join(root, 'apps'), { recursive: true })
  fs.copyFileSync(path.join(pluginRoot, 'apps/alias.js'), path.join(root, 'apps/alias.js'))
  fs.copyFileSync(path.join(pluginRoot, 'package.json'), path.join(root, 'package.json'))
  const data = path.join(root, 'tool/Hesperides/Hesperides/data')
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, 'index.json'), JSON.stringify({ schemaVersion: 2, games: { gi: { sources: { nanoka: { pages: { character: { key: 'character', ids: ['1', '2'], entries: { 1: { name: '胡桃' }, 2: { name: '刻晴' } } } } } } } } }))
  fs.writeFileSync(path.join(data, 'periods.json'), JSON.stringify({ schemaVersion: 2, games: {} }))
  const file = path.join(root, 'config/alias/gi/character.yaml')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const A = await import(pathToFileURL(path.join(root, 'model/CustomAlias.js')).href)
  const L = await import(pathToFileURL(path.join(root, 'model/AliasLoader.js')).href)
  const reset = value => { fs.writeFileSync(file, YAML.stringify(value)); L.reloadAliasMap() }
  const read = () => { try { return YAML.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }

  reset({ 胡桃: '旧称' })
  let response = await A.setAlias('gi', '刻晴', '[别称')
  check('合法标点别名写后仍可解析，原有别名保留', response.ok && read()?.刻晴 === '[别称' && read()?.胡桃 === '旧称')
  response = await A.setAlias('gi', '刻晴', '另一别称')
  check('后续设置不会丢掉已有别名', response.ok && read()?.胡桃 === '旧称' && String(read()?.刻晴).includes('[别称'))
  fs.writeFileSync(file, '胡桃: [未闭合\n')
  L.reloadAliasMap()
  const before = fs.readFileSync(file, 'utf8')
  try { response = await A.setAlias('gi', '刻晴', '正常称呼') } catch { response = { ok: false } }
  check('配置损坏时拒绝覆盖原文件', !response.ok && fs.readFileSync(file, 'utf8') === before)
  reset({ 胡桃: '旧称' })
  const concurrent = await Promise.all([A.setAlias('gi', '胡桃', '并发甲'), A.setAlias('gi', '刻晴', '并发乙')])
  check('并发添加均被保留', concurrent.every(r => r.ok) && String(read()?.胡桃).includes('并发甲') && read()?.刻晴 === '并发乙')
  reset({ 胡桃: '旧称，待删除' })
  const mixed = await Promise.all([A.setAlias('gi', '胡桃', '应保留'), A.delAlias('gi', '待删除')])
  check('添加与删除不会覆盖对方已完成的改动', mixed.every(r => r.ok) && String(read()?.胡桃).includes('应保留') && !String(read()?.胡桃).includes('待删除'))

  const stub = 'data:text/javascript,' + encodeURIComponent('export default class { constructor(config) { Object.assign(this, config) } }')
  registerHooks({ resolve (specifier, context, next) {
    return specifier.endsWith('/lib/plugins/plugin.js') ? { url: stub, shortCircuit: true } : next(specifier, context)
  } })
  const { AtlasAlias } = await import(pathToFileURL(path.join(root, 'apps/alias.js')).href)
  for (const [name, setting, event, expected] of [
    ['all 配置允许普通成员', 'all', { isMaster: false, isGroup: true, member: {} }, true],
    ['group_admin 配置允许群管理员', 'group_admin', { isMaster: false, isGroup: true, member: { is_admin: true } }, true],
    ['默认 master 允许主人', '', { isMaster: true }, true],
    ['默认 master 不允许普通成员', '', { isMaster: false }, false]
  ]) {
    fs.writeFileSync(path.join(root, 'config/config.yaml'), setting ? `alias:\n  set: ${setting}\n` : '{}\n')
    const app = new AtlasAlias()
    const rule = app.rule.find(item => item.fnc === 'aliasSetGi')
    check('规则把权限交给配置裁决：' + name, rule.permission === 'all')
    check(name, app.checkPerm({ ...event, reply () {} }, 'set') === expected)
  }
} finally {
  const relative = path.relative(path.resolve(tmpDir), path.resolve(root))
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) fs.rmSync(root, { recursive: true, force: true })
}
finish()
