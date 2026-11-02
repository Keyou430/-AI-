import { useImageTextStore } from '../../store/useImageTextStore';
import { routeExtractedContent } from '../../services/contentExtraction';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { notifyError } from '../ui/Toast';
export function ContentTypeFallback() {
  const source = useImageTextStore(s => s.pendingSource);
  const choose = (kind: 'video' | 'image-text') => {
    if (!source) return;
    try { routeExtractedContent(source, kind); }
    catch (error) { notifyError(error instanceof Error ? error.message : '素材交接失败。'); }
  };
  return <Modal open={!!source} onOpenChange={open => { if (!open) useImageTextStore.getState().setPendingSource(null); }}
    title="确认内容类型" description="提取结果缺少可靠类型凭据，请人工指定；将继续使用本次素材，不重复提取。"
    footer={<><Button onClick={() => choose('video')}>按视频继续</Button><Button variant="primary" onClick={() => choose('image-text')}>按小红书图文继续</Button></>}>
    <p className="text-sm">{source?.title}</p><p className="mt-2 text-xs text-muted-foreground">{source?.contentKindEvidence || '不能仅凭没有口播判断为图文。'}</p>
  </Modal>;
}
