import { useQuery } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useMailboxes(workspace, enabled) {
  return useQuery({
    queryKey: ['mailboxes', workspace || 'all'],
    queryFn: async () => {
      const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
      const data = await adminRequest(`/api/v1/platform/mail/mailboxes${query}`)
      return data.items || []
    },
    enabled,
    staleTime: 30_000,
  })
}
