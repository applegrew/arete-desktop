import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Avatar as PrimeAvatar } from 'primereact/avatar';
import { AvatarGroup as PrimeAvatarGroup } from 'primereact/avatargroup';

const avatarSchema = z.object({
  label: z.string().optional(),
  icon: z.string().optional(),
  image: z.string().optional(),
  shape: z.enum(['circle', 'square']).optional(),
  size: z.enum(['normal', 'large', 'xlarge']).optional(),
  weight: z.number().optional(),
});

export const AvatarApi: ComponentApi<typeof avatarSchema> = {
  name: 'Avatar',
  schema: avatarSchema,
};

export const Avatar = createComponentImplementation(AvatarApi, ({ props }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeAvatar
      label={props.label}
      icon={props.icon}
      image={props.image}
      shape={props.shape ?? 'circle'}
      size={props.size ?? 'normal'}
      style={style}
    />
  );
});

const avatarGroupSchema = z.object({
  items: z.array(avatarSchema).optional(),
  weight: z.number().optional(),
});

export const AvatarGroupApi: ComponentApi<typeof avatarGroupSchema> = {
  name: 'AvatarGroup',
  schema: avatarGroupSchema,
};

export const AvatarGroup = createComponentImplementation(AvatarGroupApi, ({ props }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeAvatarGroup style={style}>
      {(props.items ?? []).map((item, i) => (
        <PrimeAvatar
          key={i}
          label={item.label}
          icon={item.icon}
          image={item.image}
          shape={item.shape ?? 'circle'}
          size={item.size ?? 'normal'}
        />
      ))}
    </PrimeAvatarGroup>
  );
});
