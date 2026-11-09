// 挑战期「日粒度结束日」回归
//
// 上游 periods.json 里整月期给的是 `YYYY-MM-DD`（如 2026-11-01 ~ 2026-11-30）。
// 若把 end 直接解析成 00:00，11/30 中午就会判成「本期已结束」——用户看到假报。
// 本套件锁住：日粒度结束值覆盖当天；上游显式给时刻的保持原语义。
import fs from 'node:fs'
import path from 'node:path'
import { mod, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const { getHesperidesPeriods, resetHesperidesCache, HESPERIDES_DIR } = await import(mod('model/Hesperides.js'))
const { pickCurrent, parseDataTime } = await import(mod('model/ChallengePeriod.js'))
const { check, finish } = checker()

const indexPath = path.join(HESPERIDES_DIR, 'index.json')
const periodsPath = path.join(HESPERIDES_DIR, 'periods.json')
const realRead = fs.readFileSync
const realStat = fs.statSync

/** 合成一份只含一条整月期的 periods.json（不动真实产物） */
function usePeriod ({ begin, end }) {
  fs.readFileSync = (file, ...args) => {
    if (String(file) === indexPath) return JSON.stringify({ schemaVersion: 2, games: {}, channels: {} })
    if (String(file) === periodsPath) {
      return JSON.stringify({
        schemaVersion: 2,
        games: { gi: { alioth: { theater: [{ id: '30', no: 30, name: '合成整月期', begin, end }] } } }
      })
    }
    return realRead(file, ...args)
  }
  fs.statSync = (file, ...args) => (String(file) === indexPath ? { mtimeMs: Date.now(), size: 100 } : realStat(file, ...args))
}

try {
  console.log('=== ① 日粒度（YYYY-MM-DD）结束值覆盖当天 ===')
  usePeriod({ begin: '2026-11-01', end: '2026-11-30' })
  resetHesperidesCache()
  const monthly = getHesperidesPeriods('gi', 'rolecombat').periods

  check('首末日月日保持为 11/01 与 11/30',
    monthly[0].begin.getMonth() === 10 && monthly[0].begin.getDate() === 1
    && monthly[0].end.getMonth() === 10 && monthly[0].end.getDate() === 30)
  check('结束值补到当天日末（23:59:59.999）',
    monthly[0].end.getHours() === 23 && monthly[0].end.getMinutes() === 59 && monthly[0].end.getSeconds() === 59,
    monthly[0].end.toLocaleString('zh-CN'))
  check('结束日前一天仍属本期',
    pickCurrent(monthly, parseDataTime('2026-11-29 12:00:00')).state === 'current')

  const endDay = pickCurrent(monthly, parseDataTime('2026-11-30 12:00:00'))
  check('最后一天中午仍属本期（修复的核心）',
    endDay.state === 'current' && endDay.period?.id === '30', endDay.state)

  const endDayLate = pickCurrent(monthly, parseDataTime('2026-11-30 23:59:00'))
  check('最后一天 23:59 仍属本期', endDayLate.state === 'current', endDayLate.state)

  check('次月零点不再属本期',
    pickCurrent(monthly, parseDataTime('2026-12-01 00:00:00')).state === 'closed')

  console.log('\n=== ② 上游显式给时刻的保持原语义 ===')
  usePeriod({ begin: '2026-11-01 04:00:00', end: '2026-11-30 04:00:00' })
  resetHesperidesCache()
  const timed = getHesperidesPeriods('gi', 'rolecombat').periods

  check('显式结束时刻不被改成日末', timed[0].end.getHours() === 4 && timed[0].end.getMinutes() === 0,
    timed[0].end.toLocaleString('zh-CN'))
  check('结束时刻之前仍属本期',
    pickCurrent(timed, parseDataTime('2026-11-30 03:59:59')).state === 'current')
  check('结束时刻之后不再属本期',
    pickCurrent(timed, parseDataTime('2026-11-30 04:00:01')).state === 'closed')
} finally {
  fs.readFileSync = realRead
  fs.statSync = realStat
  resetHesperidesCache()
}

finish()