/**
 * Submodules — 子模块同步（长期能力）
 *
 * 只负责一件事：把 `.gitmodules` 里登记的子模块更新到远端最新提交，并报告「提交是否真的变了」，
 * 让启动编排决定要不要重建索引。历史遗留清理（攻略目录 / 退役子模块）是临时机制，
 * 放在 `model/LegacyCleanup.js`，到期整份删除，与本模块无关。
 *
 * 边界：
 * - 只处理 `TRACKED_SUBMODULES` 里点名、且**确实登记在 `.gitmodules`** 的路径
 * - 只做 git 的读写命令，不动索引、不 `rm --cached`
 * - git 缺失、网络失败、子模块未初始化都只回 `{ ok: false, error }`，绝不抛
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/** 正在使用的子模块（相对插件根） */
export const TRACKED_SUBMODULES = ['tool/Hesperides/Hesperides']

/** git 输出上限 */
const OUTPUT_LIMIT = 4 * 1024 * 1024

/**
 * 执行 git 命令
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @returns {Promise<{ok: boolean, code: number|null, stdout: string, stderr: string, error?: string}>}
 */
export function runGit (args, options = {}) {
  const { cwd = pluginRoot } = options
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString() })
    child.on('error', (err) => resolve({ ok: false, code: null, stdout, stderr, error: err.message }))
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }))
  })
}

/**
 * 读 `.gitmodules` 里登记的路径
 *
 * 子模块同步与此之外的路径判断**都走这里**，不要各自用 `existsSync('.gitmodules')` 代替
 * ——文件存在不等于这条 path 登记在里面。
 * @param {string} [root] - 仓库根，默认插件根
 * @returns {string[]} 读不到返回空数组
 */
export function gitmodulePaths (root = pluginRoot) {
  try {
    const text = fs.readFileSync(path.join(root, '.gitmodules'), 'utf8')
    return [...text.matchAll(/^\s*path\s*=\s*(.+)$/gm)].map((match) => match[1].trim())
  } catch {
    return []
  }
}

/**
 * 取某路径的 HEAD（读不到返回空串）
 * @param {string} subPath - 相对仓库根
 * @param {object} [deps]
 * @param {Function} [deps.runner]
 * @param {string} [deps.root]
 * @returns {Promise<string>}
 */
export async function submoduleCommit (subPath, deps = {}) {
  const { runner = runGit, root = pluginRoot } = deps
  const result = await runner(['-C', subPath, 'rev-parse', 'HEAD'], { cwd: root })
  return result.ok ? String(result.stdout || '').trim() : ''
}

/**
 * 同步在用的子模块（`submodule update --init --remote`）
 * @param {object} [deps]
 * @param {Function} [deps.runner]
 * @param {string} [deps.root]
 * @param {string[]} [deps.tracked]
 * @returns {Promise<{ok: boolean, skipped: boolean, updated?: string[], error?: string}>}
 *          `skipped: true` = 无需同步（没登记子模块）或提交没变
 */
export async function syncSubmodules (deps = {}) {
  const { runner = runGit, root = pluginRoot, tracked = TRACKED_SUBMODULES } = deps

  // 只在「既登记在 .gitmodules、又在跟踪清单里」时才同步
  const registered = gitmodulePaths(root)
  const existing = tracked.filter((subPath) => registered.includes(subPath))
  if (!existing.length) return { ok: true, skipped: true }

  const before = {}
  for (const subPath of existing) before[subPath] = await submoduleCommit(subPath, { runner, root })

  for (const subPath of existing) {
    const result = await runner(['submodule', 'update', '--init', '--remote', subPath], { cwd: root })
    if (!result.ok) {
      return { ok: false, skipped: false, error: (result.stderr || result.stdout || `git 退出码 ${result.code}`).trim().slice(0, 500) }
    }
  }

  const after = {}
  for (const subPath of existing) after[subPath] = await submoduleCommit(subPath, { runner, root })
  const updated = existing.filter((subPath) => before[subPath] !== after[subPath])
  return { ok: true, skipped: updated.length === 0, updated }
}