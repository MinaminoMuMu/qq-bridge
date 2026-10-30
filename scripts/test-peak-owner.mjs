import assert from 'node:assert/strict';
import { shouldPeakQuiet, isPeakBlockedTimerReason } from '../src/peak-policy.js';

// 峰价关闭：任何会话都不静默
assert.equal(shouldPeakQuiet({ peakQuiet: false, ownerPrivate: false, reason: 'proactiveCheck' }), false);
assert.equal(shouldPeakQuiet({ peakQuiet: false, ownerPrivate: true, reason: 'proactiveCheck' }), false);

// 峰价开启：群聊/他人会话全部静默
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: false, reason: 'message' }), true);
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: false, reason: 'proactiveCheck' }), true);

// 峰价开启：owner 私聊只拦定时唤醒，主人消息仍放行
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: true, reason: 'private@seq22' }), false);
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: true, reason: 'message' }), false);
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: true, reason: 'proactiveCheck' }), true);
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: true, reason: 'proactiveCheck:xxx' }), true);
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: true, reason: 'timeout' }), true);
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: true, reason: 'replyCheck:1' }), true);
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: true, reason: 'bootstrap' }), true);

// 控制台手动唤醒（admin）不拦
assert.equal(shouldPeakQuiet({ peakQuiet: true, ownerPrivate: true, reason: 'admin' }), false);
assert.equal(isPeakBlockedTimerReason('admin'), false);
assert.equal(isPeakBlockedTimerReason('proactiveCheck'), true);

console.log('peak-policy tests passed');
