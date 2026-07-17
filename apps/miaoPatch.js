/**
 * miao-plugin Avatar.check 猴子补丁（apps 入口，由 index.js 自动动态导入）
 *
 * 问题：miao-plugin priority 50，AvatarCard.check 的 accept() 中 Character.get(name)
 * 裸匹配角色名（如 #丝柯克），拦截后改写 e.msg = '#喵喵角色卡片'，使 Atlas-Plugin 无法收到消息。
 *
 * 启用时，仅 miao 专用模式（喵喵角色卡片/老公/老婆/原图/上传/添加）走原始 check，
 * 裸 #角色名 返回 false，透传给 Atlas-Plugin。
 */
import { getPluginConfig } from '../components/config.js'

// ---- 应用补丁 ----
const config = getPluginConfig()

if (config.blockMiaoAvatar) {
  try {
    const mod = await import('../../miao-plugin/apps/character/AvatarCard.js')
    const Avatar = mod.default

    if (Avatar && typeof Avatar.check === 'function') {
      const _originalCheck = Avatar.check

      Avatar.check = function (e) {
        const msg = e.original_msg || e.msg
        if (!msg || !/^#/.exec(msg)) return false

        // 仅 miao 专用模式放行，其余拦截透传
        if (/喵喵角色卡片|老公|老婆|原图|上传|添加/.test(msg)) {
          return _originalCheck.call(this, e)
        }
        return false
      }

      logger?.info('[Atlas] miao-plugin Avatar.check 补丁已应用')
    } else {
      logger?.warn('[Atlas] miao-plugin Avatar.check 未找到，跳过补丁')
    }
  } catch (err) {
    logger?.warn(`[Atlas] miao 补丁异常: ${err.message}`)
  }
}
