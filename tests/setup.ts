import { PrismaClient } from '@prisma/client'

export const testPrisma = new PrismaClient()

export const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'
export const TEST_API_KEY = 'karute-dev-key-change-me'

export async function cleanupTestData() {
  await testPrisma.customer.deleteMany({
    where: { tenantId: TEST_TENANT_ID },
  })
}

export async function seedTestCustomer(overrides?: Record<string, any>) {
  return testPrisma.customer.create({
    data: {
      tenantId: TEST_TENANT_ID,
      name: 'テスト太郎',
      furigana: 'テストタロウ',
      email: 'test@example.com',
      phone: '090-1234-5678',
      locale: 'ja',
      ...overrides,
    },
  })
}
