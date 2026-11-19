import type { VideoProvider } from '../domain/dictionary.ts';

/** No widget, iframe, SDK, tracking or remote requests. Activation belongs to M4 after permission checks. */
export const externalVideoProvider: VideoProvider = {
  getVideo(term, accent) {
    if (!term.trim()) return { status: 'unavailable', reason: '请输入单词或短语。' };
    return {
      status: 'external-only',
      url: `https://youglish.com/pronounce/${encodeURIComponent(term.trim())}/english/${accent.toLowerCase()}`,
      reason: '内嵌视频待授权确认；当前可前往 YouGlish 搜索，是否有匹配结果以该站为准。',
    };
  },
};
