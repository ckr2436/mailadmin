import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useCreateMailbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => adminRequest('/api/v1/platform/mail/mailboxes', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] })
    },
  })
}
