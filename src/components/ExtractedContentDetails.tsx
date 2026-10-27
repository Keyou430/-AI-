import type { ParsedVideoInfo } from '../types';
import { Button } from './ui/Button';
import { isVisibleExtractionNotice } from '../lib/extractionNotices';

export function ExtractedContentDetails({
  content,
  onUseText,
}: {
  content: ParsedVideoInfo;
  onUseText?: (text: string) => void;
}) {
  const details = content.extractionDetails;
  if (!details) return null;
  const imageText = details.images
    .map((image, index) =>
      image.ocr.trim() ? '第' + (index + 1) + '张图片文字：\n' + image.ocr : ''
    )
    .filter(Boolean);
  const editableText = [
    content.publishedText,
    ...(imageText.length ? imageText : details.ocrText),
    ...details.onScreen.map((item) => item.text),
  ]
    .filter(Boolean)
    .join('\n\n');
  return (
    <div className="space-y-3">
      {details.warnings.filter(isVisibleExtractionNotice).map((warning, index) => (
        <p
          key={index}
          role="status"
          data-testid="extraction-warning"
          className="status-note text-warning"
        >
          {warning}
        </p>
      ))}
      <details data-testid="extraction-details" className="disclosure">
        <summary>
          提取详情与图片文字
          {details.credits !== undefined && (
            <span className="ml-2 font-normal text-muted-foreground">{details.credits} 积分</span>
          )}
        </summary>
        <div className="mt-4 space-y-5">
          <p className="muted-copy">
            本次消耗：{details.credits === undefined ? '厂商未返回' : details.credits + ' 积分'}
            {details.cached ? '（缓存结果）' : ''}
          </p>
          {details.coverage && (
            <p className="muted-copy">
              已转写 {details.coverage.secondsTranscribed ?? '未知'} /{' '}
              {details.coverage.durationSeconds ?? '未知'} 秒；已读取图片{' '}
              {details.coverage.imagesRead ?? '未知'} / {details.coverage.imagesTotal ?? '未知'}{' '}
              张。
            </p>
          )}
          {details.images.length > 0 && (
            <section className="space-y-4">
              <h4 className="text-xs font-medium text-foreground">图片文字与描述</h4>
              <p className="muted-copy">编号按接口返回顺序，未独立验证原帖顺序；空项保留。</p>
              {details.images.map((image, index) => (
                <div key={index} data-testid="image-ocr" className="space-y-2 border-t pt-3">
                  <h5 className="text-xs font-medium text-foreground">第 {index + 1} 张</h5>
                  <p className="reading-text">{image.ocr || '未返回图片文字'}</p>
                  {image.description && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      智能图片描述：{image.description}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}
          {details.ocrText.length > 0 && (
            <details>
              <summary className="cursor-pointer py-1">图片文字汇总</summary>
              <p data-testid="ocr-text" className="reading-text mt-2">
                {details.ocrText.join('\n')}
              </p>
            </details>
          )}
          {details.onScreen.length > 0 && (
            <section>
              <h4 className="field-label">画面文字（时间为近似值）</h4>
              {details.onScreen.map((item, index) => (
                <p key={index} className="reading-text mt-2">
                  {item.t === null ? '时间未知' : item.t + ' 秒'}：{item.text}
                </p>
              ))}
            </section>
          )}
          {details.keyPoints.length > 0 && (
            <details>
              <summary className="cursor-pointer py-1">智能分析要点（不等于原文）</summary>
              <p className="reading-text mt-2">{details.keyPoints.join('\n')}</p>
            </details>
          )}
          {onUseText && (
            <>
              <Button
                type="button"
                size="sm"
                data-testid="use-extracted-text"
                disabled={!editableText.trim()}
                onClick={() => onUseText(editableText)}
              >
                将正文／图片文字填入编辑区
              </Button>
              <p className="muted-copy">此操作替换当前修改稿，原始素材保留。</p>
            </>
          )}
        </div>
      </details>
    </div>
  );
}
