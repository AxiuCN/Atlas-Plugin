/**
 * 历史遗留清理回归（**整套对应临时机制**，到期随 `model/LegacyCleanup.js` 一起删除）
 *
 * 覆盖：攻略目录清理（整目录删除 / 同级目录不受影响 / 幂等 / 符号链接只摘链接）、
 * 退役子模块清理（三处残留 / 外层目录保留 / 幂等 / dryRun / 登记在 .gitmodules 时跳过）、
 * 统一入口 `runLegacyCleanup()` 的执行顺序。
 */
import fs from 'node:fs'
import path from 'node:path'
import { mod, tmpDir, checker, installFrameworkStubs, logs } from './_helper.mjs'

installFrameworkStubs()
fs.mkdirSync(tmpDir, { recursive: true })

const {
  cleanupLegacyCodexDir,
  pruneRetiredSubmodules,
  runLegacyCleanup,
  RETIRED_SUBMODULES
} = await import(mod('model/LegacyCleanup.js'))

const { check, finish } = checker()

const RETIRED = RETIRED_SUBMODULES[0]

/** 造一个临时「仓库根」，可带 .gitmodules */
function makeRoot (name, gitmodules = '') {
  const root = fs.mkdtempSync(path.join(tmpDir, `legacy-${name}-`))
  fs.writeFileSync(path.join(root, '.gitmodules'), gitmodules)
  return root
}

/** 在 root 下造退役子模块的三处残留 + 返回 config 路径 */
function makeRetiredRemains (root, subPath = RETIRED) {
  fs.mkdirSync(path.join(root, subPath, 'data'), { recursive: true })
  fs.writeFileSync(path.join(root, subPath, 'data', 'map.json'), '{}')
  fs.mkdirSync(path.join(root, '.git', 'modules', ...subPath.split('/')), { recursive: true })
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.appendFileSync(
    path.join(root, '.git', 'config'),
    `[submodule "${subPath}"]\n\turl = https://example.invalid/old.git\n`
  )
  return path.join(root, '.git', 'config')
}

/** 模拟真实 git：`config --remove-section` 会真的把段从 .git/config 里删掉 */
function makeRunner (root, calls = []) {
  return async (args) => {
    calls.push(args.join(' '))
    if (args[0] === 'config' && args[1] === '--remove-section') {
      const section = args[2].replace(/^submodule\./, '')
      const configPath = path.join(root, '.git', 'config')
      const kept = fs.readFileSync(configPath, 'utf8').split('\n')
        .filter((line) => !line.includes(`[submodule "${section}"]`))
        .filter((line) => !line.includes('example.invalid/old.git'))
        .join('\n')
      fs.writeFileSync(configPath, kept)
    }
    return { ok: true, code: 0, stdout: '', stderr: '' }
  }
}

console.log('=== ① 攻略遗留目录清理（2026-12-14 到期）===')
{
  const root = fs.mkdtempSync(path.join(tmpDir, 'legacy-codex-'))
  const legacy = path.join(root, 'tool', 'Character-Codex-Data')
  const sibling = path.join(root, 'tool', 'nanoka-atlas-backend')
  fs.mkdirSync(path.join(legacy, 'Character-Codex-Data', '.git'), { recursive: true })
  fs.writeFileSync(path.join(legacy, 'README.md'), 'legacy')
  fs.mkdirSync(sibling, { recursive: true })
  fs.writeFileSync(path.join(sibling, 'keep.txt'), 'keep')

  const before = logs.length
  const first = cleanupLegacyCodexDir({ root })
  check('检测到遗留目录即整目录删除', first.removed === true && !fs.existsSync(legacy))
  check('已记 info 日志', logs.length > before)
  check('同级目录不受影响', fs.existsSync(path.join(sibling, 'keep.txt')))

  const second = cleanupLegacyCodexDir({ root })
  check('再次调用为空操作（absent，不打日志）', second.removed === false && second.reason === 'absent')

  // 符号链接只摘链接本身，不跟进目标
  const outside = path.join(tmpDir, 'legacy-outside-target')
  fs.rmSync(outside, { recursive: true, force: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'must-stay.txt'), 'x')
  try {
    fs.symlinkSync(outside, legacy, 'junction')
    const third = cleanupLegacyCodexDir({ root })
    check('符号链接/联接只摘链接，目标内容保留', third.removed === true && fs.existsSync(path.join(outside, 'must-stay.txt')))
    check('链接本身已移除', !fs.existsSync(legacy))
  } catch (err) {
    console.log(`  （本机无法创建链接，跳过符号链接用例：${err.message}）`)
  }

  fs.rmSync(path.join(root, 'tool'), { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\n=== ② 退役子模块清理（2026-12-31 到期）===')
{
  const root = makeRoot('prune')
  const outer = path.join(root, 'tool', 'nanoka-atlas-backend')
  const inner = path.join(outer, 'nanoka-atlas-backend')
  const configPath = makeRetiredRemains(root)
  // 外层目录里用户自己的东西必须保留
  fs.mkdirSync(path.join(outer, '.dsh'), { recursive: true })
  fs.writeFileSync(path.join(outer, '.dsh', 'keep.txt'), 'user data')

  const calls = []
  const result = await pruneRetiredSubmodules({ root, runner: makeRunner(root, calls) })

  check('三处残留都记进 actions', result.pruned[0]?.actions.join(',') === 'config,workdir,gitmodules-dir', JSON.stringify(result.pruned))
  check('工作目录已删除', !fs.existsSync(inner))
  check('外层目录与用户内容保留', fs.existsSync(path.join(outer, '.dsh', 'keep.txt')))
  check('.git/modules 对象已删除', !fs.existsSync(path.join(root, '.git', 'modules', ...RETIRED.split('/'))))
  check('.git/config 段已移除', !fs.readFileSync(configPath, 'utf8').includes(RETIRED))
  check('执行了 git config --remove-section', calls.some((cmd) => cmd.startsWith('config --remove-section submodule.')))
  check('没有失败项', result.failed.length === 0)

  const again = await pruneRetiredSubmodules({ root, runner: makeRunner(root) })
  check('二次清理为空操作', again.pruned.length === 0 && again.failed.length === 0)
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\n=== ③ dryRun 与安全边界 ===')
{
  const root = makeRoot('dry')
  makeRetiredRemains(root)
  const plan = await pruneRetiredSubmodules({ root, runner: makeRunner(root), dryRun: true })
  check('dryRun 仍报告计划', plan.pruned[0]?.actions.length === 3, JSON.stringify(plan.pruned))
  check('dryRun 不删工作目录', fs.existsSync(path.join(root, RETIRED)))
  check('dryRun 不删 modules 对象', fs.existsSync(path.join(root, '.git', 'modules', ...RETIRED.split('/'))))
  check('dryRun 不改 .git/config', fs.readFileSync(path.join(root, '.git', 'config'), 'utf8').includes(RETIRED))
  fs.rmSync(root, { recursive: true, force: true })
}
{
  // 路径仍登记在 .gitmodules → 即便列为退役也不碰（防误删在用子模块）
  const root = makeRoot('registered', `[submodule "x"]\n\tpath = ${RETIRED}\n`)
  makeRetiredRemains(root)
  const result = await pruneRetiredSubmodules({ root, runner: makeRunner(root) })
  check('仍登记在 .gitmodules 的路径被跳过', result.pruned.length === 0, JSON.stringify(result.pruned))
  check('其工作目录保留', fs.existsSync(path.join(root, RETIRED)))
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\n=== ④ 统一入口 runLegacyCleanup ===')
{
  const root = makeRoot('run')
  const codex = path.join(root, 'tool', 'Character-Codex-Data')
  fs.mkdirSync(codex, { recursive: true })
  makeRetiredRemains(root)

  const order = []
  const runner = async (args) => {
    order.push(args[0])
    return { ok: true, code: 0, stdout: '', stderr: '' }
  }
  const result = await runLegacyCleanup({ root, runner })
  check('两处清理都跑了', result.codex.removed === true && result.submodules.pruned.length === 1)
  check('攻略目录已删除', !fs.existsSync(codex))
  check('退役子模块工作目录已删除', !fs.existsSync(path.join(root, RETIRED)))
  check('退役清理走的是 git config（不是自己改文件）', order.includes('config'))
  fs.rmSync(root, { recursive: true, force: true })
}

finish()