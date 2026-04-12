import { ImgHTMLAttributes, useState } from 'react';

export const Image = ({ alt, src, ...props }: ImgHTMLAttributes<HTMLImageElement>) => {
  const [broken, setBroken] = useState(false);

  if (broken || !src) {
    return <div className="bg-[#FFE4E8] text-[#6B7280] text-xs flex items-center justify-center" {...(props as never)}>{alt ?? 'image'}</div>;
  }

  return <img alt={alt} src={src} onError={() => setBroken(true)} {...props} />;
};
