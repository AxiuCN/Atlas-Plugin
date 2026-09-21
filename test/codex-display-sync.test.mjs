/**
 * 攻略显示层镜像的漂移守卫：model/codexIndex/display.js 必须与攻略仓库的
 * scripts/lib/guide-display.mjs **逐字节相同**
 *
 * 同一份「显示级归一」规则在两个仓库各留一份——运行期不能依赖尚未 pull 的攻略仓库。
 * 面板（插件）用插件副本，网页版（攻略仓库）用规范副本；两份一漂移，面板与网页版的
 * 措辞就会不一致（上游有 scripts/check-display-sync.mjs 与 --write 同步，本套件是插件侧的对偶）。
 *
 * 前置：攻略仓库（缺失则跳过）。上游文件不存在（仓库结构变动）也只打印说明后跳过——
 * 那是需要人来处理的契约变更，不该表现为一次假失败。
 * 本套件**不修改** display.js：它与上游逐字节相同是硬契约，加注释即破坏契约。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pluginRoot, codexDir, hasCodexRepo, skip, checker } from './_helper.mjs'

const MIRROR = path.join(pluginRoot, 'model/codexIndex/display.js')
const UPSTREAM = path.join(codexDir, 'scripts/lib/guide-display.mjs')

if (!hasCodexRepo()) skip('角色攻略仓库未拉取（先执行 #图鉴初始化 / #图鉴更新）')
if (!fs.existsSync(UPSTREAM)) skip(`上游规范副本不存在（攻略仓库结构变了？）：${path.relative(codexDir, UPSTREAM)}`)

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const size = (f) => fs.statSync(f).size

const upstreamHash = sha(UPSTREAM)
const mirrorHash = sha(MIRROR)

console.log('\n=== 显示级归一：插件副本 vs 攻略仓库规范副本 ===')
console.log(`  规范副本 ${path.relative(pluginRoot, UPSTREAM)}  ${size(UPSTREAM)} 字节  ${upstreamHash.slice(0, 16)}…`)
console.log(`  插件副本 model/codexIndex/display.js  ${size(MIRROR)} 字节  ${mirrorHash.slice(0, 16)}…`)

const { check, finish } = checker()

check('两份逐字节相同', upstreamHash === mirrorHash,
  upstreamHash === mirrorHash ? '' : '已漂移：在攻略仓库改规范副本后跑 node scripts/check-display-sync.mjs --write')

// 镜像仍被解析层使用（防止"守卫还在、镜像已弃用"的空转）
const parseSrc = fs.readFileSync(path.join(pluginRoot, 'model/codexIndex/parse.js'), 'utf8')
check('parse.js 仍引用该镜像', /from\s+'\.\/display\.js'/.test(parseSrc))

finish()
