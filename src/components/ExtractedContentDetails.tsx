import type { ParsedVideoInfo } from '../types';

export function ExtractedContentDetails({ content, onUseText }: { content: ParsedVideoInfo; onUseText?: (text: string) => void }) {
  const details = content.extractionDetails;
  if (!details) return null;
  const imageText = details.images.map((image, index) => image.ocr.trim() ? '第' + (index + 1) + '张图片文字：\n' + image.ocr : '').filter(Boolean);
  const editableText = [content.publishedText, ...(imageText.length ? imageText : details.ocrText),
    ...details.onScreen.map(item => item.text)].filter(Boolean).join('\n\n');
  return <details data-testid="extraction-details" className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" open={details.warnings.length > 0 || !content.transcript.trim()}>
    <summary className="cursor-pointer font-semibold">LinkDigest 提取详情／图片文字</summary>
    <div className="mt-3 space-y-3">
      <p>本次消耗：{details.credits === undefined ? '厂商未返回' : details.credits + ' 积分'}{details.cached ? '（缓存结果）' : ''}</p>
      {details.coverage && <p>覆盖凭据：口播 {details.coverage.secondsTranscribed ?? '未知'} 秒／视频 {details.coverage.durationSeconds ?? '未知'} 秒；图片 {details.coverage.imagesRead ?? '未知'}／{details.coverage.imagesTotal ?? '未知'} 张。</p>}
      {details.warnings.map((warning, index) => <p key={index} data-testid="extraction-warning" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900">{warning}</p>)}
      {details.images.length > 0 && <section className="space-y-2">
        <h4 className="font-semibold">图片文字与描述（按接口返回顺序）</h4>
        <p className="text-slate-500">编号对应接口返回位置，未独立验证原帖顺序；空项保留，不自动补写。</p>
        {details.images.map((image, index) => <div key={index} data-testid="image-ocr" className="space-y-1 rounded-lg border border-slate-200 bg-white p-2">
          <h5 className="font-semibold">第 {index + 1} 张</h5>
          <p className="whitespace-pre-wrap">{image.ocr || '未返回图片文字'}</p>
          {image.description && <p className="whitespace-pre-wrap text-slate-500">图片描述（AI 识别，非原文）：{image.description}</p>}
        </div>)}
      </section>}
      {details.ocrText.length > 0 && <section><h4 className="font-semibold">可见文字汇总（OCR）</h4><p data-testid="ocr-text" className="mt-1 whitespace-pre-wrap">{details.ocrText.join('\n')}</p></section>}
      {details.onScreen.length > 0 && <section><h4 className="font-semibold">视频画面文字（时间为近似值）</h4>{details.onScreen.map((item, index) => <p key={index} className="mt-1 whitespace-pre-wrap">{item.t === null ? '时间未知' : item.t + ' 秒'}：{item.text}</p>)}</section>}
      {details.keyPoints.length > 0 && <section><h4 className="font-semibold">AI 要点（不等于原文）</h4><p className="mt-1 whitespace-pre-wrap">{details.keyPoints.join('\n')}</p></section>}
      {onUseText && <button type="button" data-testid="use-extracted-text" disabled={!editableText.trim()} onClick={() => onUseText(editableText)}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-700 disabled:opacity-50">将正文／OCR 填入编辑区（替换当前修改稿）</button>}
    </div>
  </details>;
}
