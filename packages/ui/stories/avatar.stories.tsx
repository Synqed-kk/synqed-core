import type { Meta, StoryObj } from '@storybook/react'
import { Avatar } from '../src/components/avatar'

const meta: Meta<typeof Avatar> = {
  title: 'Components/Avatar',
  component: Avatar,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl'] },
  },
}
export default meta
type Story = StoryObj<typeof Avatar>

export const Default: Story = { args: { initials: 'TT', size: 'md' } }
export const Large: Story = { args: { initials: 'TT', size: 'xl' } }
export const CustomColor: Story = { args: { initials: 'SH', size: 'md', color: '#6366f1' } }

export const Group: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Avatar initials="TT" color="#c8873e" />
      <Avatar initials="SH" color="#6366f1" />
      <Avatar initials="YK" color="#22c55e" />
      <Avatar initials="IM" color="#ec4899" />
    </div>
  ),
}
