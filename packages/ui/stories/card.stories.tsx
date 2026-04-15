import type { Meta, StoryObj } from '@storybook/react'
import { Card, CardTitle, CardValue, CardDescription } from '../src/components/card'

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
}
export default meta
type Story = StoryObj<typeof Card>

export const StatCard: Story = {
  render: () => (
    <Card style={{ width: 200 }}>
      <CardTitle>Today</CardTitle>
      <CardValue>5</CardValue>
      <CardDescription>bookings</CardDescription>
    </Card>
  ),
}

export const BentoGrid: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: 420 }}>
      <Card><CardTitle>Bookings</CardTitle><CardValue>5</CardValue><CardDescription>2 remaining</CardDescription></Card>
      <Card><CardTitle>Clients</CardTitle><CardValue>47</CardValue><CardDescription>total</CardDescription></Card>
      <Card><CardTitle>Week</CardTitle><CardValue>23</CardValue><CardDescription>sessions</CardDescription></Card>
      <Card><CardTitle>Records</CardTitle><CardValue>18</CardValue><CardDescription>generated</CardDescription></Card>
    </div>
  ),
}
