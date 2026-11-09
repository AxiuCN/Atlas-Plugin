/**
 * 初始化/更新的「失败」判定回归
 *
 * 背景：Hesperides CLI 现在只要**任何条目**失败就返回退出码 1（个别 503 也算），
 * 但那种情况产物通常可用。旧代码把 `ret.ok === false` 一律当「初始化失败」，
 * 于是出现「数据已经抓好了，通知却说初始化失败」。
 *
 * 本套件锁住分类函数的判定边界（通过 admin.js 的公开行为不可达，故按源码语义 + 数据状态验证）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pluginRoot, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
const { check, finish } = checker()

const adminSrc = fs.readFileSync(path.join(pluginRoot, 'apps/admin.js'), 'utf8')

console.log('=== ① 失败判定改为「先看产物是否可用」===')
{
  check('有 dataLooksUsable 辅助', /function dataLooksUsable\s*\(/.test(adminSrc))
  check('有 classifyScrapeResult 分类函数', /function classifyScrapeResult\s*\(/.test(adminSrc))
  check('分类函数在失败分支前先查产物',
    /if \(!dataLooksUsable\(\)\) return \{ failed: true/.test(adminSrc))
  check('产物可用时返回 failed:false 并带告警',
    /failed: false,\s*\n\s*warning: ret\?\.timedOut/.test(adminSrc))
  check('超时与「有条目未抓到」区分文案',
    /抓取超时，数据可能不完整/.test(adminSrc) && /有未抓到的条目，数据可能不完整/.test(adminSrc))
}

console.log('\n=== ② 初始化与更新都走同一分类 ===')
{
  // 两块都用「起点 → 该块自己的 catch」切片，避免被前一块的同名片段截断
  const initStart = adminSrc.indexOf("runScrapeAsync({ mode: 'full'")
  const initBlock = adminSrc.slice(initStart, adminSrc.indexOf('}).catch(', initStart))
  check('初始化用 classifyScrapeResult', /const verdict = classifyScrapeResult\(ret\)/.test(initBlock))
  check('初始化不再用裸 !ret.ok 判失败', !/if \(!ret\.ok\) \{\s*\n\s*this\._notifyResult\(`\[Atlas\] 图鉴初始化失败/.test(initBlock))
  check('初始化完成消息带上告警', /初始化完成\$\{verdict\.warning/.test(initBlock))

  const updateStart = adminSrc.indexOf('retryDelayMs: cfg?.autoUpdate?.retryDelayMs')
  const updateBlock = adminSrc.slice(updateStart, adminSrc.indexOf('}).catch(', updateStart))
  check('更新用 classifyScrapeResult', /const verdict = classifyScrapeResult\(ret\)/.test(updateBlock))
  check('更新完成消息带上告警', /图鉴更新完成\$\{modeLabel\}\$\{verdict\.warning/.test(updateBlock))
}

console.log('\n=== ③ 群消息不播报内部实现 ===')
{
  // 进度类消息里不应出现数据源名、抓取范围、子模块、模式等技术细节
  const progressLines = adminSrc.split('\n').filter((line) => line.includes('e.reply('))
  const leaky = progressLines.filter((line) => /nanoka|玉璃|子模块|全量模式|含图片|完整性检查/.test(line))
  check('进度消息不暴露数据源/范围/实现细节', leaky.length === 0,
    leaky.length ? leaky.map((l) => l.trim().slice(0, 60)).join(' | ') : '')

  check('启动抓取只有一句「正在更新图鉴数据」',
    adminSrc.includes("await e.reply('[Atlas] 正在更新图鉴数据，请稍候...', false)"))
  check('进度消息不再承诺「完成后将通知」',
    !progressLines.some((line) => /完成后将通知|完成后通知/.test(line)))

  check('未初始化时给出可执行指令', /请先使用 #图鉴初始化/.test(adminSrc))
}

finish()