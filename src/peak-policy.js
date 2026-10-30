// 峰谷静默策略（纯函数，便于单测；bridge.js 只做薄调用）。
//
// 规则（方案 A）：
// - 非 owner 私聊：峰价完全静默（群聊/他人会话只入库不唤醒）。
// - owner 私聊：峰价只拦“定时唤醒”（proactiveCheck / timeout / replyCheck / bootstrap），
//   主人主动发消息仍可叫醒；admin（控制台手动唤醒）不拦。
const PEAK_BLOCKED_TIMER_REASONS = new Set(['timeout', 'replyCheck', 'proactiveCheck', 'bootstrap']);

export function isPeakBlockedTimerReason(reason) {
  return PEAK_BLOCKED_TIMER_REASONS.has(String(reason ?? '').split(':')[0]);
}

export function shouldPeakQuiet({ peakQuiet, ownerPrivate, reason = null }) {
  if (peakQuiet !== true) return false;
  if (!ownerPrivate) return true;
  return isPeakBlockedTimerReason(reason);
}
