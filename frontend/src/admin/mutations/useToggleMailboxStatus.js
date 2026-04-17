import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useToggleMailboxStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ email, active }) => adminRequest(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(email)}/status`, {
      method: 'PATCH',
      body: { active },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
    },
  })
}
