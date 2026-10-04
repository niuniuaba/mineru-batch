import type { UploadItem } from '../lib/uploadChain'
import { DropZone } from './DropZone'
import { Modal } from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (items: UploadItem[]) => void
  busy: boolean
}

export function UploadDialog({ open, onClose, onSubmit, busy }: Props) {
  return (
    <Modal open={open} title="Add documents" onClose={onClose}>
      <DropZone
        busy={busy}
        onSubmit={(items) => {
          onSubmit(items)
          onClose()
        }}
      />
    </Modal>
  )
}
