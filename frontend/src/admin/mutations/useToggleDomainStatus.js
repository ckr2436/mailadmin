import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useToggleDomainStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ domain, active }) => adminRequest(`/api/v1/platform/mail/domains/${encodeURIComponent(domain)}/status`, {
      method: 'PATCH',
      body: { active },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['domains'] })
    },
  })
}
