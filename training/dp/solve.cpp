#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <vector>
#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#else
#include <sys/resource.h>
#endif
#include "kernel.h"

// V[remaining category mask][upper score capped at 63] is FUTURE reward.
// Bonus is paid only on the transition that first crosses 63.
// Multiset probabilities are obtained by repeatedly averaging six fair faces.
int main(int argc,char**argv){
  const auto started=std::chrono::steady_clock::now();
  std::vector<double> values(4096*64,0.0);
  std::array<double,252> stop,cur,next;
  std::array<double,462> expectation;
  long long solved=0,pruned=0;
  for(int mask=1;mask<4096;mask++){
    int cats[12],count=0,maxUpper=0;
    for(int c=0;c<12;c++)if(mask&(1<<c)){cats[count++]=c;if(c<6)maxUpper+=5*(c+1);}
    for(int order=0;order<64;order++){
      const int upper=order==0?63:order-1;
      if(upper<63&&upper+maxUpper<63){values[mask*64+upper]=values[mask*64+63];pruned++;continue;}
      solved++;
      for(int d=0;d<252;d++){
        double best=-1e300;
        for(int j=0;j<count;j++){
          const int c=cats[j],p=points[d][c],u=c<6?std::min(63,upper+p):upper;
          best=std::max(best,p+(upper<63&&u==63?35.0:0.0)+values[(mask^(1<<c))*64+u]);
        }
        stop[d]=cur[d]=best;
      }
      for(int roll=0;roll<2;roll++){
        std::copy(cur.begin(),cur.end(),expectation.begin()+210);
        for(int h=209;h>=0;h--){double sum=0;for(int face=0;face<6;face++)sum+=expectation[children[h][face]];expectation[h]=sum/6.0;}
        for(int d=0;d<252;d++){
          double best=stop[d];
          for(int j=holdOffsets[d];j<holdOffsets[d+1];j++)best=std::max(best,expectation[held[j]]);
          next[d]=best;
        }
        cur.swap(next);
      }
      double value=0;for(int d=0;d<252;d++)value+=probabilities[d]*cur[d];
      values[mask*64+upper]=value;
    }
    if(mask%256==0)std::cerr<<"DP masks "<<mask<<"/4095\n";
  }
  std::ofstream output(argc>1?argv[1]:"public/ai/dp-values.f64",std::ios::binary);
  output.write(reinterpret_cast<const char*>(values.data()),values.size()*sizeof(double));output.close();
  const double seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-started).count();
  long long peak=0;
#ifdef _WIN32
  PROCESS_MEMORY_COUNTERS memory;GetProcessMemoryInfo(GetCurrentProcess(),&memory,sizeof(memory));peak=memory.PeakWorkingSetSize;
#else
  struct rusage memory;getrusage(RUSAGE_SELF,&memory);peak=memory.ru_maxrss*1024;
#endif
  std::cout.precision(15);
  std::cout<<"{\"initialExpectedScore\":"<<values[4095*64]<<",\"seconds\":"<<seconds<<",\"peakRssBytes\":"<<peak<<",\"tableBytes\":"<<values.size()*8<<",\"solvedCardStates\":"<<solved<<",\"prunedCardStates\":"<<pruned<<"}\n";
}
