import { createComponentImplementation } from '@a2ui/react/v0_9';
import { ImageApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { Image as PrimeImage } from 'primereact/image';

export const Image = createComponentImplementation(ImageApi, ({ props }) => {
  const style: Record<string, unknown> = {
    ...(typeof props.weight === 'number'
      ? { flex: props.weight, minWidth: 0, minHeight: 0 }
      : {}),
  };
  if (props.variant === 'icon') {
    style.width = '24px';
    style.height = '24px';
  } else if (props.variant === 'avatar') {
    style.width = '40px';
    style.height = '40px';
    style.borderRadius = '50%';
  }
  return (
    <PrimeImage
      src={typeof props.url === 'string' ? props.url : ''}
      alt={typeof props.description === 'string' ? props.description : ''}
      width={style.width as string}
      height={style.height as string}
      preview
      style={style}
    />
  );
});
