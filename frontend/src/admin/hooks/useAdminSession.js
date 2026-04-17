import { useQuery } from '@tanstack/react-query'
import { adminRequest } from '../api'

function fetchAdminSession() {
  return adminRequest('/api/v1/platform/auth/session')
}

export function useAdminSession() {
  return useQuery({
    queryKey: ['adminSession'],
    queryFn: fetchAdminSession,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
