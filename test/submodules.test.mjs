/**
 * 子模块同步回归（注入 runner，全部离线）
 *
 * 只覆盖 `model/Submodules.js` 的长期能力：`.gitmodules` 路径解析、HEAD 读取、
 * `submodule update` 的 skipped 判定与失败透传。历史遗留清理是临时机制，见 `legacy-cleanup.test.mjs`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { mod, tmpDir, checker } from './_helper.mjs'

fs.mkdirSync(tmpDir, { recursive: true })

const {
  gitmodulePaths,
  submoduleCommit,
  syncSubmodules,
  TRACKED_SUBMODULES
} = await import(mod('model/Submodules.js'))

const { check, finish } = checker()

/** 造一个临时「仓库根」：只有 .gitmodules（内容可选） */
function makeRepo (name, gitmodules) {
  const root = fs.mkdtempSync(path.join(tmpDir, `sync-${name}-`))
  if (gitmodules !== undefined) fs.writeFileSync(path.join(root, '.gitmodules'), gitmodules)
  return root
}

const HESPERIDES = 'tool/Hesperides/Hesperides'

console.log('=== ① .gitmodules 路径解析 ===')
{
  const root = makeRepo('parse', [
    '[submodule "tool/Hesperides/Hesperides"]',
    '\tpath = tool/Hesperides/Hesperides',
    '\turl = https://example.invalid/hes.git',
    '[submodule "other"]',
    '\tpath = tool/Other/Inner',
    '\turl = https://example.invalid/other.git'
  ].join('\n'))
  const paths = gitmodulePaths(root)
  check('解析出全部 path', paths.length === 2, JSON.stringify(paths))
  check('path 值不带空白', paths.includes(HESPERIDES) && paths.includes('tool/Other/Inner'))
  check('url 不会被误当 path', !paths.some((item) => item.includes('example.invalid')))
  fs.rmSync(root, { recursive: true, force: true })
}
{
  const root = makeRepo('empty')
  check('.gitmodules 不存在 → 空数组', Array.isArray(gitmodulePaths(root)) && gitmodulePaths(root).length === 0)
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\n=== ② 跟踪清单 ===')
check('默认跟踪 Hesperides', TRACKED_SUBMODULES.includes(HESPERIDES))

console.log('\n=== ③ 同步：登记校验（曾经的 filter bug）===')
{
  // 目录存在但**没登记**在 .gitmodules → 不该去 sync（git 会报错）
  const root = makeRepo('unregistered', '[submodule "x"]\n\tpath = tool/Other/Inner\n')
  fs.mkdirSync(path.join(root, HESPERIDES), { recursive: true })
  let called = false
  const runner = async () => {
    called = true
    return { ok: true, code: 0, stdout: '', stderr: '' }
  }
  const result = await syncSubmodules({ root, runner })
  check('未登记的子模块不同步', result.ok === true && result.skipped === true && called === false, JSON.stringify(result))
  fs.rmSync(root, { recursive: true, force: true })
}
{
  const root = makeRepo('nogitmodules')
  let called = false
  const runner = async () => {
    called = true
    return { ok: true, code: 0, stdout: '', stderr: '' }
  }
  const result = await syncSubmodules({ root, runner })
  check('没有 .gitmodules → 直接 skipped 且不跑 git', result.skipped === true && called === false)
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\n=== ④ 同步：skipped 与 updated 判定 ===')
{
  const root = makeRepo('same', `[submodule "h"]\n\tpath = ${HESPERIDES}\n`)
  let revParse = 0
  const calls = []
  const runner = async (args) => {
    calls.push(args[0])
    if (args[0] === '-C') {
      revParse++
      return { ok: true, code: 0, stdout: 'same-sha\n', stderr: '' }
    }
    return { ok: true, code: 0, stdout: '', stderr: '' }
  }
  const result = await syncSubmodules({ root, runner })
  check('提交没变 → skipped', result.ok === true && result.skipped === true)
  check('updated 为空数组', Array.isArray(result.updated) && result.updated.length === 0)
  check('确实执行了 submodule update', calls.includes('submodule'))
  check('跑了两轮 rev-parse 比对提交', revParse === 2, String(revParse))
  fs.rmSync(root, { recursive: true, force: true })
}
{
  const root = makeRepo('changed', `[submodule "h"]\n\tpath = ${HESPERIDES}\n`)
  let revParse = 0
  const runner = async (args) => {
    if (args[0] === '-C') {
      revParse++
      return { ok: true, code: 0, stdout: revParse <= 1 ? 'before-sha\n' : 'after-sha\n', stderr: '' }
    }
    return { ok: true, code: 0, stdout: '', stderr: '' }
  }
  const result = await syncSubmodules({ root, runner })
  check('提交变化 → skipped=false', result.ok === true && result.skipped === false)
  check('updated 指出变化的路径', result.updated?.includes(HESPERIDES), JSON.stringify(result.updated))
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\n=== ⑤ 失败与容错 ===')
{
  const root = makeRepo('fail', `[submodule "h"]\n\tpath = ${HESPERIDES}\n`)
  const runner = async (args) => {
    if (args[0] === '-C') return { ok: true, code: 0, stdout: 'sha\n', stderr: '' }
    return { ok: false, code: 128, stdout: '', stderr: 'fatal: boom' }
  }
  const result = await syncSubmodules({ root, runner })
  check('update 失败透传 stderr', result.ok === false && /boom/.test(result.error || ''), result.error)
  fs.rmSync(root, { recursive: true, force: true })
}
{
  const root = makeRepo('commit', `[submodule "h"]\n\tpath = ${HESPERIDES}\n`)
  check('取不到 HEAD 返回空串', await submoduleCommit(HESPERIDES, {
    root,
    runner: async () => ({ ok: false, code: 1, stdout: '', stderr: '' })
  }) === '')
  check('取到 HEAD 去掉首尾空白', await submoduleCommit(HESPERIDES, {
    root,
    runner: async () => ({ ok: true, code: 0, stdout: '  abc123  \n', stderr: '' })
  }) === 'abc123')
  fs.rmSync(root, { recursive: true, force: true })
}

finish()