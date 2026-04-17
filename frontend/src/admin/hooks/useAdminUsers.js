import { useQuery } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useAdminUsers(enabled) {
  return useQuery({
    queryKey: ['adminUsers'],
    queryFn: () => adminRequest('/api/v1/platform/admin-users'),
    enabled,
    select: (data) => data.items || [],
    staleTime: 30_000,
  })
}
