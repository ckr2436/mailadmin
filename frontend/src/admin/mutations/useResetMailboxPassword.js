import { useMutation } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useResetMailboxPassword() {
  return useMutation({
    mutationFn: ({ email, newPassword }) => adminRequest(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(email)}/password`, {
      method: 'POST',
      body: { new_password: newPassword },
    }),
  })
}
