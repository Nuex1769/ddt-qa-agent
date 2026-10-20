import * as Alert from '@radix-ui/react-alert-dialog'
import { Button } from './button'

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  busy,
  error,
  onConfirm,
  confirmLabel = '确认删除',
  pendingLabel = '正在删除…',
  destructive = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  busy: boolean
  error?: string
  onConfirm: () => void
  confirmLabel?: string
  pendingLabel?: string
  destructive?: boolean
}) {
  return (
    <Alert.Root open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <Alert.Portal>
        <Alert.Overlay className="dialog-overlay" />
        <Alert.Content className="dialog-content confirm-dialog">
          <div className="dialog-header">
            <Alert.Title>{title}</Alert.Title>
            <Alert.Description>{description}</Alert.Description>
          </div>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <Alert.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                取消
              </Button>
            </Alert.Cancel>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </Alert.Content>
      </Alert.Portal>
    </Alert.Root>
  )
}
