import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useSaveDomain() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => adminRequest('/api/v1/platform/mail/domains', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['domains'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] })
    },
  })
}
