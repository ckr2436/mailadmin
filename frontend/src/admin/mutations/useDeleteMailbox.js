import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useDeleteMailbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (email) => adminRequest(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] })
    },
  })
}
