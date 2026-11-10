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
import { pluginRoot, mod, checker, installFrameworkStubs } from './_helper.mjs'

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

  // 状态图渲染成功时才是用户的默认视图：告警必须进图，不能只留在文字回退里
  const imageWithWarning = adminSrc.match(/renderStatusImage\(\{ changes, warning: verdict\.warning \}\)/g) || []
  check('更新与定时任务的状态图都带上告警', imageWithWarning.length === 2, `count=${imageWithWarning.length}`)
  check('定时任务的文字回退也带上告警', /每日自动更新完成\$\{modeLabel\}\$\{verdict\.warning/.test(adminSrc))
}

console.log('\n=== ③ 群消息不播报内部实现 ===')
{
  // 进度类消息里不应出现数据源名、抓取范围、子模块、模式等技术细节
  const progressLines = adminSrc.split('\n').filter((line) => line.includes('e.reply('))
  const leaky = progressLines.filter((line) => /nanoka|玉璃|子模块|全量模式|含图片|完整性检查/.test(line))
  check('进度消息不暴露数据源/范围/实现细节', leaky.length === 0,
    leaky.length ? leaky.map((l) => l.trim().slice(0, 60)).join(' | ') : '')

  check('启动抓取只有一句「开始更新图鉴数据」',
    adminSrc.includes("await e.reply('[Atlas] 开始更新图鉴数据，请稍候...', false)"))
  check('进度消息不再承诺「完成后将通知」',
    !progressLines.some((line) => /完成后将通知|完成后通知/.test(line)))

  check('未初始化时给出可执行指令', /请先使用 #图鉴初始化/.test(adminSrc))
}

console.log('\n=== ③-b 已有抓取在跑：不是失败，也不群发 ===')
{
  // 预检：三条命令与定时任务都先看 isScraping()，只回当前会话（BUSY_TEXT），不进 _notifyResult
  const busyGuards = adminSrc.match(/if \(isScraping\(\)\)/g) || []
  check('四条入口都有预检（初始化/强制初始化/更新/定时任务）', busyGuards.length === 4, `count=${busyGuards.length}`)
  check('预检用统一答复且只走 e.reply', adminSrc.includes("const BUSY_TEXT = '[Atlas] 已有抓取任务在运行...'")
    && /if \(isScraping\(\)\) \{\s*\n\s*await e\.reply\(BUSY_TEXT, false\)/.test(adminSrc))
  check('预检在「上次未完成」提示之前（不误导用户重抓）',
    adminSrc.indexOf('if (isScraping())') < adminSrc.indexOf('检测到上次初始化未完整完成'))
  check('更新把预检放在版本检查之前（不干等 5 秒再报失败）',
    adminSrc.indexOf('if (isScraping())', adminSrc.indexOf('async handleUpdate')) < adminSrc.indexOf('await checkRemoteVersions'))

  // 竞态兜底：异步链里拿到 busy 只写日志，不通报失败
  const busySkips = adminSrc.match(/if \(ret\?\.busy\)/g) || []
  check('三条异步链都拦 busy（初始化/更新/定时任务）', busySkips.length === 3, `count=${busySkips.length}`)
  const busyBlocks = adminSrc.split('if (ret?.busy)').slice(1).map((s) => s.slice(0, 220))
  check('拦 busy 时只写日志、不进 _notifyResult',
    busyBlocks.every((block) => !block.slice(0, block.indexOf('}')).includes('_notifyResult')))

  // 模型层：busy 是可区分的字段（套件 scrape-lock 里做行为断言）
  check('补抓也透传 busy', /return \{ ok: result\.ok, missing, busy: result\.busy/.test(
    fs.readFileSync(path.join(pluginRoot, 'model/AtlasUpdater.js'), 'utf8')))
}

console.log('\n=== ④ 缺一整个游戏 ≠ 完成 ===')
{
  // 行为级：直接喂合成索引给 missingGames（不依赖本机数据）
  const { missingGames } = await import(mod('model/AtlasUpdater.js'))
  const page = (records) => ({ sources: { nanoka: { pages: { character: { records } } } } })
  const index = (games) => ({ schemaVersion: 2, games })

  const full = index({ gi: page(120), hsr: page(80), zzz: page(60) })
  check('三游戏都有角色页 → 不缺', missingGames(full).length === 0)

  const partial = index({ gi: page(120), hsr: page(0), zzz: undefined })
  check('缺 hsr 与 zzz → 逐个列出', JSON.stringify(missingGames(partial)) === '["hsr","zzz"]',
    JSON.stringify(missingGames(partial)))

  const aliothOnly = index({ gi: page(120), hsr: { sources: { alioth: { pages: { character: { records: 5 } } } } }, zzz: page(1) })
  check('只有玉璃记录、没有 nanoka 角色页 → 仍算缺', missingGames(aliothOnly).join(',') === 'hsr',
    missingGames(aliothOnly).join(','))

  check('索引读不出来 → 三个都缺', missingGames(null).length === 3)

  // 源码级：三处流程都要在抓完（补抓后）用 gap 判定，并给出「未完成」+ 行动项
  const gapCount = (adminSrc.match(/const gap = missingGames\(\)/g) || []).length
  check('初始化 / 更新 / 定时任务三处都做缺口判定', gapCount === 3, `count=${gapCount}`)
  check('初始化缺游戏文案', adminSrc.includes('图鉴初始化未完成：缺少'))
  check('更新缺游戏文案', adminSrc.includes('图鉴更新未完成：缺少'))
  check('定时任务缺游戏文案', adminSrc.includes('定时更新未完成：缺少'))
  check('缺口判定在重新索引之后（数据仍可用）',
    adminSrc.indexOf('const gap = missingGames()') > adminSrc.indexOf('reloadIndex()'))
}

console.log('\n=== ⑤ 异常详情只给主人 ===')
{
  // 每个把 err.message / ret.error 直接塞进通知的调用点，都必须带第二个参数（群文案）
  const singleArgLeak = /this\._notifyResult\(\s*`[^`]*(err\.message|ret\.error)[^`]*`\s*\)/g
  const leaks = adminSrc.match(singleArgLeak) || []
  check('异常路径不再只传一份文本', leaks.length === 0,
    leaks.map((l) => l.replace(/\s+/g, ' ').slice(0, 70)).join(' | '))

  const groupTexts = [
    '[Atlas] 图鉴初始化失败，可再次发送 #图鉴初始化 重跑',
    '[Atlas] 图鉴初始化后数据加载失败，请稍后重试 #图鉴初始化',
    '[Atlas] 图鉴初始化异常中止，请稍后重试 #图鉴初始化',
    '[Atlas] 图鉴更新失败，可再次发送 #图鉴更新 重跑',
    '[Atlas] 图鉴更新后数据加载失败，请稍后重试 #图鉴更新',
    '[Atlas] 图鉴更新异常中止，请稍后重试 #图鉴更新',
    '[Atlas] 定时更新失败，可稍后发送 #图鉴更新 重跑'
  ]
  const missingTexts = groupTexts.filter((text) => !adminSrc.includes(text))
  check('群文案都给出「发生了什么 + 可做什么」', missingTexts.length === 0, missingTexts.join(' | '))

  check('通知走统一派发（收件人由 notify.js 决定）', /dispatchNotify\(Bot, targets/.test(adminSrc))
  check('admin.js 不再自己调 Bot.send*', !/Bot\.send(Master|Group|Friend)Msg/.test(adminSrc))
}

finish()