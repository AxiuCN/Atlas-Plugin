// 「角色攻略」开关回归：默认启用、关闭后放行、恢复配置无损
// 注意：本套件会临时改写 config/config.yaml，finally 中按 MD5 校验并按原字节还原
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { mod, pluginRoot, tmpDir, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const configFile = path.join(pluginRoot, 'config/config.yaml')
const backupFile = path.join(tmpDir, 'config.yaml.switch-test.bak')

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

const { isCodexEnabled } = await import(mod('components/config.js'))
const { handleQuery } = await import(mod('modules/atlasQuery.js'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}
async function run (gameId, keyword) {
  const replies = []
  const e = { msg: `#${keyword}`, reply: async (m) => { replies.push(typeof m === 'string' ? m : '[segment]') } }
  try {
    await handleQuery(e, gameId, keyword)
    return { consumed: true, reply: replies[0] || '' }
  } catch (err) {
    return { consumed: `THROW: ${err.message}`, reply: replies[0] || '' }
  }
}
async function consumed (gameId, keyword) {
  const ret = await handleQuery({ reply: async () => {} }, gameId, keyword)
  return ret !== false
}

const original = fs.existsSync(configFile) ? fs.readFileSync(configFile) : null
const originalHash = original ? md5(original) : '(不存在)'
console.log(`config.yaml ${original ? '存在' : '不存在'}，原 MD5 ${originalHash}`)

try {
  fs.mkdirSync(path.dirname(backupFile), { recursive: true })
  if (original) fs.writeFileSync(backupFile, original)

  console.log('\n=== 1. 默认（配置里没有 codex 段）→ 启用 ===')
  check('isCodexEnabled() = true', isCodexEnabled() === true)
  check('#丝柯克攻略 被消费', await consumed('gi', '丝柯克攻略'))
  check('#胡桃攻略 被消费（暂无攻略数据）', await consumed('gi', '胡桃攻略'))

  console.log('\n=== 2. codex.enabled: false → 放行 ===')
  fs.writeFileSync(configFile, '# 测试用配置\npriority: 10000\nrenderScale: 1.5\n\ncodex:\n  enabled: false\n', 'utf8')
  check('isCodexEnabled() = false', isCodexEnabled() === false)
  check('#丝柯克攻略 放行', (await consumed('gi', '丝柯克攻略')) === false)
  check('#胡桃攻略 放行', (await consumed('gi', '胡桃攻略')) === false)
  check('#角色攻略 放行', (await consumed('gi', '角色攻略')) === false)
  check('*符玄指南 放行', (await consumed('hsr', '符玄指南')) === false)
  const other = await run('gi', '胡桃')
  check('普通查询不受影响（#胡桃 仍被消费）', other.consumed === true, JSON.stringify(other.reply))
  const patch = await run('gi', '如雷套')
  check('「套」后缀不受影响（#如雷套 仍被消费）', patch.consumed === true)

  console.log('\n=== 3. codex.enabled: true → 恢复接管 ===')
  fs.writeFileSync(configFile, 'codex:\n  enabled: true\n', 'utf8')
  check('isCodexEnabled() = true', isCodexEnabled() === true)
  check('#丝柯克攻略 被消费', await consumed('gi', '丝柯克攻略'))
} finally {
  if (original) fs.writeFileSync(configFile, original)
  const restored = fs.existsSync(configFile) ? md5(fs.readFileSync(configFile)) : '(不存在)'
  console.log(`\n配置还原：${restored === originalHash ? 'MD5 一致 ✅' : '不一致 ❌ ' + restored}`)
  fs.rmSync(backupFile, { force: true })
}

console.log('\n=== 4. 配置模板与锅巴字段 ===')
const defSet = fs.readFileSync(path.join(pluginRoot, 'defSet/config.yaml'), 'utf8')
const example = fs.readFileSync(path.join(pluginRoot, 'config/config.yaml.example'), 'utf8')
/** codex 段（允许段内夹注释行；兼容 CRLF） */
const codexBlock = (text) => /^codex:\r?\n(?:[ \t]*#[^\n]*\r?\n)*[ \t]*enabled:[ \t]*(\S+)/m.exec(text)
check('defSet 模板含 ${atlas_codex_enabled}', defSet.includes('${atlas_codex_enabled}'))
check('defSet 模板 codex.enabled = 模板变量', codexBlock(defSet)?.[1] === '${atlas_codex_enabled}', String(codexBlock(defSet)?.[1]))
check('config.yaml.example codex.enabled = true', codexBlock(example)?.[1] === 'true', String(codexBlock(example)?.[1]))

const { supportGuoba } = await import(mod('guoba/index.js'))
const guoba = supportGuoba().configInfo
const field = guoba.schemas.find(s => s.field === 'codex.enabled')
check('锅巴 schema 含 codex.enabled（Switch）', field?.component === 'Switch', JSON.stringify(field?.label))
const data = guoba.getConfigData()
check('锅巴 getConfigData 回填 codex.enabled = true', data['codex.enabled'] === true, String(data['codex.enabled']))

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
