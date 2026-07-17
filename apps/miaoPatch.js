/**
 * miao-plugin character accept 猴子补丁（apps 入口，由 index.js 自动动态导入）
 *
 * 问题：miao-plugin priority 50，character accept 中 Character.get(name)
 * 裸匹配角色名（如 #丝柯克），拦截后改写 e.msg = '#喵喵角色卡片'，使 Atlas-Plugin 无法收到消息。
 *
 * 不能只 patch Avatar.check — v3App() 中 check.push(app.check) 已捕获原始引用。
 * 必须 patch CharacterClass.prototype.accept。
 *
 * 启用时，仅 miao 专用模式（喵喵角色卡片/老公/老婆/原图/上传/添加）走原始 accept，
 * 裸 #角色名 返回 undefined，透传给 Atlas-Plugin。
 */
import { getPluginConfig } from '../components/config.js'

const config = getPluginConfig()

if (config.blockMiaoAvatar) {
  try {
    const mod = await import('../../miao-plugin/apps/index.js')
    const CharacterClass = mod.apps?.character

    if (!CharacterClass?.prototype?.accept) {
      logger?.warn('[Atlas] miao character accept 未找到，跳过补丁')
    } else {
      const originalAccept = CharacterClass.prototype.accept

      CharacterClass.prototype.accept = function (e) {
        const msg = e.original_msg || e.msg
        if (!msg || !/^#/.exec(msg)) return originalAccept.call(this, e)

        // 仅 miao 专用模式放行，其余拦截透传
        if (/喵喵角色卡片|老公|老婆|原图|上传|添加/.test(msg)) {
          return originalAccept.call(this, e)
        }
        // 裸 #角色名 不拦截
      }

      logger?.info('[Atlas] miao character accept 补丁已应用')
    }
  } catch (err) {
    logger?.warn(`[Atlas] miao 补丁异常: ${err.message}`)
  }
}
