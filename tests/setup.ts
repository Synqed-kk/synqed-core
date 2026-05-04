import { PrismaClient } from '@prisma/client'

export const testPrisma = new PrismaClient()

export const TEST_BUSINESS_ID = '00000000-0000-0000-0000-000000000001'
export const TEST_API_KEY = 'karute-dev-key-change-me'

export async function cleanupTestData() {
  // Order matters: delete FK children before parents
  await testPrisma.karuteEntry.deleteMany({
    where: { karuteRecord: { businessId: TEST_BUSINESS_ID } },
  })
  await testPrisma.karuteRecord.deleteMany({
    where: { businessId: TEST_BUSINESS_ID },
  })
  await testPrisma.appointment.deleteMany({
    where: { businessId: TEST_BUSINESS_ID },
  })
  await testPrisma.staff.deleteMany({
    where: { businessId: TEST_BUSINESS_ID },
  })
  await testPrisma.customer.deleteMany({
    where: { businessId: TEST_BUSINESS_ID },
  })
}

export async function seedTestCustomer(overrides?: Record<string, any>) {
  return testPrisma.customer.create({
    data: {
      businessId: TEST_BUSINESS_ID,
      name: 'テスト太郎',
      furigana: 'テストタロウ',
      email: 'test@example.com',
      phone: '090-1234-5678',
      locale: 'ja',
      ...overrides,
    },
  })
}

export async function seedTestStaff(overrides?: Record<string, any>) {
  return testPrisma.staff.create({
    data: {
      businessId: TEST_BUSINESS_ID,
      name: 'テストスタッフ',
      role: 'STYLIST',
      isActive: true,
      ...overrides,
    },
  })
}

export async function seedTestKaruteRecord(overrides: {
  customerId?: string | null
  staffId: string
  createdAt?: Date
  status?: 'DRAFT' | 'REVIEW' | 'APPROVED'
}) {
  return testPrisma.karuteRecord.create({
    data: {
      businessId: TEST_BUSINESS_ID,
      customerId: overrides.customerId ?? null,
      staffId: overrides.staffId,
      status: overrides.status ?? 'DRAFT',
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  })
}

export async function seedTestAppointment(overrides: {
  customerId: string
  staffId: string
  startsAt: Date
  endsAt: Date
  status?: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
}) {
  return testPrisma.appointment.create({
    data: {
      businessId: TEST_BUSINESS_ID,
      customerId: overrides.customerId,
      staffId: overrides.staffId,
      startsAt: overrides.startsAt,
      endsAt: overrides.endsAt,
      status: overrides.status ?? 'SCHEDULED',
    },
  })
}
