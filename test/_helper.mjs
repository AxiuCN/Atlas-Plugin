/**
 * 套件公共设施：路径推导 / 前置检查 / 断言计数 / 框架全局桩
 *
 * 套件约定（见插件 CLAUDE.md「测试」一节）：
 * - **任意 cwd 可跑**：路径一律由本文件位置推导，不写裸相对字面量、不写盘符绝对路径
 * - **缺前置就跳过、不算失败**：图鉴数据未初始化 / 攻略仓库未拉取 / 没有可用浏览器时，
 *   打印「跳过：原因」并 exit 0 —— 否则新克隆的仓库一跑全红
 * - **不改动源数据**：临时产物一律写 `test/.test-tmp/`（gitignore）；确需临时改配置的
 *   （如渲染缩放用例改 config.yaml）必须按原字节还原
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 套件目录 */
export const testDir = path.dirname(fileURLToPath(import.meta.url))
/** 插件根目录 */
export const pluginRoot = path.resolve(testDir, '..')
/** bot 根目录（app/） */
export const appRoot = path.resolve(pluginRoot, '../..')
/** 图鉴数据引擎根目录（submodule） */
export const backendRoot = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend')
/** 图鉴数据目录 */
export const dataDir = path.join(backendRoot, 'data')
/** 角色攻略仓库（git clone） */
export const codexDir = path.join(pluginRoot, 'tool/Character-Codex-Data/Character-Codex-Data')
/** 套件临时产物目录（gitignore） */
export const tmpDir = path.join(testDir, '.test-tmp')

// 切到 bot 根：框架渲染后端按 cwd 解析 `renderers/` 与 `temp/`（生产环境 cwd 就是 bot 根），
// 不切的话触及渲染链的套件（atlasQuery / apps.status 等）在插件根下会因找不到 renderers 而报错。
// 套件自身的路径全部由 import.meta.url 推导，不受影响。
process.chdir(appRoot)

/**
 * 生产代码的 file URL（套件 import 用，避免写死盘符）
 * @param {string} relPath - 相对插件根，如 'modules/atlasQuery.js'
 * @returns {string}
 */
export const mod = (relPath) => pathToFileURL(path.join(pluginRoot, relPath)).href

/** 确保临时目录存在并返回 */
export function ensureTmpDir () {
  fs.mkdirSync(tmpDir, { recursive: true })
  return tmpDir
}

/* ============================================================
 *  前置检查（缺则跳过）
 * ============================================================ */

/** 图鉴数据是否已就绪（map.json 存在） */
export function hasAtlasData () {
  return fs.existsSync(path.join(dataDir, 'map.json'))
}

/** 攻略仓库是否已拉取 */
export function hasCodexRepo () {
  return fs.existsSync(path.join(codexDir, '.git'))
}

/** 找一个可用浏览器（框架渲染后端通过 chromiumPath 指定）：返回路径或空串 */
export function findBrowser () {
  const candidates = [
    process.env.ATLAS_TEST_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ].filter(Boolean)
  return candidates.find(p => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  }) || ''
}

/** 打印「跳过」并正常退出（不算失败） */
export function skip (reason) {
  console.log(`⏭ 跳过：${reason}`)
  process.exit(0)
}

/**
 * 确保 git 替身已编译，返回其所在目录；编译不出来返回空串
 *
 * 替身源码在 test/fixtures/fake-git/（FakeGit.cs + build.ps1），产物落在 .test-tmp/ 不入库；
 * Windows 上 spawn/execSync 只认可执行文件，所以必须是 .exe（不能是 .cmd/.ps1）。
 * 非 Windows 或没有 .NET 编译器时返回空串，调用方按「跳过」处理。
 * @returns {string}
 */
export function ensureFakeGit () {
  const dir = path.join(tmpDir, 'fake-git')
  const exe = path.join(dir, 'git.exe')
  if (fs.existsSync(exe)) return dir
  if (process.platform !== 'win32') return ''

  const script = path.join(testDir, 'fixtures/fake-git/build.ps1')
  if (!fs.existsSync(script)) return ''
  const shells = ['pwsh', 'powershell']
  for (const shell of shells) {
    try {
      const ret = spawnSync(shell, ['-NoProfile', '-File', script], { encoding: 'utf8' })
      if (fs.existsSync(exe)) return dir
      if (ret.error) continue
      console.log(`  （${shell} 编译 git 替身未成功：${String(ret.stderr || ret.stdout || '').trim().slice(0, 200)}）`)
    } catch { /* 换下一个 shell */ }
  }
  return ''
}

/** 前置：图鉴数据 */
export function requireAtlasData () {
  if (!hasAtlasData()) skip('图鉴数据未初始化（先执行 #图鉴初始化 / #图鉴更新）')
}

/** 前置：攻略仓库 */
export function requireCodexRepo () {
  if (!hasCodexRepo()) skip('角色攻略仓库未拉取（先执行 #图鉴初始化 / #图鉴更新）')
}

/* ============================================================
 *  断言计数
 * ============================================================ */

/**
 * 建一个断言计数器
 * @returns {{check: Function, counts: Function, finish: Function}}
 */
export function checker () {
  let pass = 0
  let fail = 0
  return {
    check (name, ok, extra = '') {
      ok ? pass++ : fail++
      console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`)
    },
    counts: () => ({ pass, fail }),
    /** 打印汇总并按失败数退出 */
    finish () {
      console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
      process.exit(fail === 0 ? 0 : 1)
    }
  }
}

/* ============================================================
 *  框架全局桩（logger / redis / cfg / segment）
 * ============================================================ */

/** 套件期间收集到的日志（logger.info/warn/error 的参数） */
export const logs = []

/**
 * 安装框架全局桩
 *
 * 生产代码依赖 bot 注入的全局（logger、redis、cfg、segment）与 logger 的着色方法；
 * 套件里补上这些桩即可在不启动 bot 的情况下跑真实代码路径。
 * @param {object} [opts]
 * @param {boolean} [opts.collect] - 是否把日志收进 logs（默认 true，不打印）
 * @param {boolean} [opts.echoError] - 是否把 logger.error 打到 stderr（便于看渲染等失败原因）
 */
export function installFrameworkStubs (opts = {}) {
  const { collect = true, echoError = false } = opts
  const record = (level) => (...args) => {
    if (collect) logs.push(args)
    if (echoError && level === 'error') console.error('[error]', ...args.map(a => (a && a.stack) || String(a)))
  }
  const paint = () => (v) => String(v ?? '')
  globalThis.logger = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    mark: record('mark'),
    debug: record('debug'),
    green: paint(), red: paint(), cyan: paint(), yellow: paint(), blue: paint(),
    gray: paint(), magenta: paint(), white: paint(), bold: paint()
  }
  globalThis.redis = { get: async () => null, set: async () => {}, del: async () => {} }
  globalThis.cfg = { bot: {}, renderer: {} }
  globalThis.segment = { image: (x) => x }
}
