// 抓取锁回归
//   ① 活跃锁（pid 存活）→ 拒绝且不进入抓取流程
//   ② 僵尸锁（pid 已死）→ 清理后继续（抓取本身用 1ms 超时立即掐断，不真跑）
//   ③ 过期锁（pid 存活但超过 TTL）→ 视为残留并继续
//   ④ 机制级并发：8 进程竞争同一锁文件，「先检查后写」会出现多个成功（复现旧窗口），
//      「flag:'wx' 原子创建」恰好 1 个成功（修复后的性质）
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mod, backendRoot, tmpDir, ensureTmpDir, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()
ensureTmpDir()

const { runScrapeAsync } = await import(mod('model/AtlasUpdater.js'))
const LOCK = path.join(backendRoot, 'data', '_scraping.lock')

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`)
}
const writeLock = (data) => {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true })
  fs.writeFileSync(LOCK, JSON.stringify(data), 'utf8')
}

console.log('=== ① 活跃锁（本进程 pid）===')
fs.rmSync(LOCK, { force: true })
writeLock({ pid: process.pid, time: new Date().toISOString() })
{
  const t0 = Date.now()
  const ret = await runScrapeAsync(30000)
  const ms = Date.now() - t0
  check('活跃锁被拒绝（提示锁文件占用）', ret.ok === false && /锁文件检测/.test(String(ret.error)), JSON.stringify(ret))
  check('未进入抓取流程（立即返回）', ms < 500, `${ms}ms`)
  check('活跃锁文件保持存在', fs.existsSync(LOCK))
}

console.log('\n=== ② 僵尸锁（pid 已死）===')
fs.rmSync(LOCK, { force: true })
writeLock({ pid: 999999, time: new Date().toISOString() })
{
  const ret = await runScrapeAsync(1) // 1ms 超时：锁被清理并进入抓取后立即掐断，不会真跑抓取
  check('僵尸锁被清理后继续（报错不再是锁占用）', !/锁文件检测/.test(String(ret.error)), JSON.stringify(ret).slice(0, 120))
  check('流程结束后锁已释放', !fs.existsSync(LOCK))
}

console.log('\n=== ③ 过期锁（pid 存活但超 TTL）===')
writeLock({ pid: process.pid, time: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() })
{
  const ret = await runScrapeAsync(1)
  check('过期锁视为残留并继续', !/锁文件检测/.test(String(ret.error)), JSON.stringify(ret).slice(0, 120))
  check('流程结束后锁已释放', !fs.existsSync(LOCK))
}
fs.rmSync(LOCK, { force: true })

console.log('\n=== ④ 机制级并发（8 进程竞争同一锁文件）===')
const childScript = path.join(tmpDir, 'lock-race-child.mjs')
fs.writeFileSync(childScript, `
import fs from 'node:fs'
const [mode, lockFile] = process.argv.slice(2)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
if (mode === 'old') {
  // 旧写法：先检查再写（人为插入 120ms 放大窗口）
  if (!fs.existsSync(lockFile)) {
    await sleep(120)
    fs.writeFileSync(lockFile, String(process.pid))
    console.log('ACQUIRED')
  } else {
    console.log('BUSY')
  }
} else {
  // 新写法：flag:'wx' 原子创建
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' })
    console.log('ACQUIRED')
  } catch {
    console.log('BUSY')
  }
}
`, 'utf8')

const raceConcurrent = (mode, n = 8) => new Promise((resolve) => {
  const lockFile = path.join(tmpDir, `lock-race-${mode}.lock`)
  fs.rmSync(lockFile, { force: true })
  let done = 0
  let acquired = 0
  for (let i = 0; i < n; i++) {
    const cp = spawn(process.execPath, [childScript, mode, lockFile], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    cp.stdout.on('data', d => { out += d })
    cp.on('close', () => {
      if (out.includes('ACQUIRED')) acquired++
      if (++done === n) {
        fs.rmSync(lockFile, { force: true })
        resolve(acquired)
      }
    })
  }
})
const oldConcurrent = await raceConcurrent('old')
const newConcurrent = await raceConcurrent('new')
check('并发「先检查后写」出现多个成功（证明旧窗口真实存在）', oldConcurrent > 1, `${oldConcurrent}/8 成功`)
check('并发「wx 原子创建」恰好 1 个成功', newConcurrent === 1, `${newConcurrent}/8 成功`)

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
