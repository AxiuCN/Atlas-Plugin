// 攻略仓库同步回归：用 git 替身（PATH 最前）顶替真实 git，全程无网络
//   覆盖 clone / pull（最新 / 有更新）/ 失败 / 并发 / 各入口的提示文案
// 注意：本套件绝不删除已存在的 .git —— 测 clone 分支时把 .git 改名后原样还原
// 前置：需要已拉取的攻略仓库；需要能编译 test/fixtures/fake-git（Windows + .NET），否则跳过
import fs from 'node:fs'
import path from 'node:path'
import { mod, codexDir, tmpDir, ensureTmpDir, ensureFakeGit, skip, requireCodexRepo, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireCodexRepo()
ensureTmpDir()

const fakeGitDir = ensureFakeGit()
if (!fakeGitDir) skip('git 替身不可用（需要在 Windows 上编译 test/fixtures/fake-git/FakeGit.cs）')
process.env.PATH = `${fakeGitDir};${process.env.PATH}`
const gitLog = path.join(tmpDir, 'fake-git-calls.log')
process.env.FAKE_GIT_LOG = gitLog
delete process.env.FAKE_GIT_OUT
delete process.env.FAKE_GIT_EXIT

const { syncCodexRepo, isInitialized, isDataIntact } = await import(mod('model/AtlasUpdater.js'))
const { AtlasAdmin } = await import(mod('apps/admin.js'))

const gitDir = path.join(codexDir, '.git')
const bakDir = path.join(codexDir, '.git.codex-sync-test')
const hadRepo = fs.existsSync(gitDir)

const gitCalls = () => (fs.existsSync(gitLog) ? fs.readFileSync(gitLog, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [])
const resetLog = () => fs.rmSync(gitLog, { force: true })

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
}

/** 临时移开 .git（可逆）以走 clone 分支 */
async function withoutRepo (fn) {
  const exists = fs.existsSync(gitDir)
  if (exists) fs.renameSync(gitDir, bakDir)
  try {
    return await fn()
  } finally {
    if (exists && fs.existsSync(bakDir)) fs.renameSync(bakDir, gitDir)
    if (exists && fs.existsSync(bakDir)) throw new Error('还原 .git 失败，请手工把 .git.codex-sync-test 改回 .git')
  }
}

/** 保证有 .git（本就存在则原样使用，只清理自己创建的） */
async function withRepo (fn) {
  const existed = fs.existsSync(gitDir)
  if (!existed) fs.mkdirSync(gitDir, { recursive: true })
  try {
    return await fn()
  } finally {
    if (!existed) fs.rmSync(gitDir, { recursive: true, force: true })
  }
}

/** 跑一次 admin 的同步步骤，返回回复列表 */
async function runAdminSync (opts = {}) {
  if (opts.gitOut !== undefined) process.env.FAKE_GIT_OUT = opts.gitOut
  else delete process.env.FAKE_GIT_OUT
  if (opts.gitExit !== undefined) process.env.FAKE_GIT_EXIT = String(opts.gitExit)
  else delete process.env.FAKE_GIT_EXIT
  const replies = []
  const e = { reply: async (m) => { replies.push(typeof m === 'string' ? m : '[segment]') } }
  const admin = new AtlasAdmin()
  const ret = opts.viaInit
    ? await admin.handleInit(e)
    : await admin._syncCodexRepo(opts.withEvent === false ? undefined : e)
  return { replies, ret }
}

console.log(`本地状态：攻略仓库 ${hadRepo ? '已拉取' : '未拉取'}｜图鉴 initialized=${isInitialized()} intact=${isDataIntact()}`)

console.log('\n=== 1. 仓库未拉取 → clone 成功 ===')
resetLog()
const r1 = await withoutRepo(() => syncCodexRepo())
check('ok / mode=clone / updated=true', r1.ok === true && r1.mode === 'clone' && r1.updated === true, JSON.stringify(r1))
check('git 参数为 clone --depth 1', (gitCalls()[0] || '').startsWith('clone --depth 1'), gitCalls()[0] || '(无)')
check('.git 已原样还原', hadRepo ? fs.existsSync(gitDir) : true)

console.log('\n=== 2. 已拉取 → pull：远端无新内容 ===')
resetLog()
const r2 = await withRepo(() => syncCodexRepo())
check('ok / mode=pull / updated=false', r2.ok === true && r2.mode === 'pull' && r2.updated === false, JSON.stringify(r2))
check('git 参数为 pull --ff-only', gitCalls()[0] === 'pull --ff-only', gitCalls()[0] || '(无)')

console.log('\n=== 3. 已拉取 → pull：远端有新提交 ===')
resetLog()
process.env.FAKE_GIT_OUT = 'Updating 1dcf7bf..abcdef1\nFast-forward'
const r3 = await withRepo(() => syncCodexRepo())
check('updated=true', r3.ok === true && r3.updated === true, JSON.stringify(r3))
delete process.env.FAKE_GIT_OUT

console.log('\n=== 4. git 失败 → ok=false（不影响主流程）===')
resetLog()
process.env.FAKE_GIT_EXIT = '1'
const r4 = await withRepo(() => syncCodexRepo())
check('ok=false 且带回错误', r4.ok === false && !!r4.error, JSON.stringify(r4))
delete process.env.FAKE_GIT_EXIT

console.log('\n=== 5. 并发保护：两次并发只调一次 git，复用同一结果对象 ===')
resetLog()
const [a, b] = await withRepo(() => Promise.all([syncCodexRepo(), syncCodexRepo()]))
check('两次调用返回同一对象', a === b)
check('git 只被调用一次', gitCalls().length === 1, `实际 ${gitCalls().length} 次`)

console.log('\n=== 6. 命令流提示文案 ===')
let r = await withoutRepo(() => runAdminSync({ viaInit: true })) // 未拉取 → clone
check('初始化：先提示正在同步', r.replies.some(m => m === '[Atlas] 正在同步角色攻略仓库，请稍候...'), JSON.stringify(r.replies))
check('初始化：回「已克隆完成」', r.replies.some(m => m === '[Atlas] 角色攻略仓库已克隆完成'), '')
check('初始化：数据已完整的原有提示仍在', r.replies.some(m => m === '[Atlas] 图鉴数据已初始化且完整，无需重复抓取'), '')
check('初始化：返回 true', r.ret === true)

r = await withRepo(() => runAdminSync({}))
check('更新：已拉取且无新内容 → 「已是最新」', r.replies.includes('[Atlas] 角色攻略仓库已是最新'), JSON.stringify(r.replies))

r = await withRepo(() => runAdminSync({ gitOut: 'Updating 1dcf7bf..abcdef1' }))
check('更新：有新提交 → 「已更新」', r.replies.includes('[Atlas] 角色攻略仓库已更新'), JSON.stringify(r.replies))

r = await withRepo(() => runAdminSync({ gitExit: 1 }))
check('更新：失败 → 明确提示失败原因', r.replies.some(m => m.startsWith('[Atlas] 角色攻略仓库同步失败（不影响图鉴数据）')), JSON.stringify(r.replies))

r = await runAdminSync({ withEvent: false })
check('定时任务：不传 e → 静默（无回复）', r.replies.length === 0, JSON.stringify(r.replies))

console.log(`\n最终检查：攻略仓库 .git ${fs.existsSync(gitDir) ? '仍在 ✅' : '丢失 ❌'}｜残留备份目录 ${fs.existsSync(bakDir) ? '有 ❌' : '无 ✅'}`)
console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
