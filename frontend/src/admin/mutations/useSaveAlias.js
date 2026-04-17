import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useSaveAlias() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => adminRequest('/api/v1/platform/mail/aliases', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['aliases'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] })
    },
  })
}
